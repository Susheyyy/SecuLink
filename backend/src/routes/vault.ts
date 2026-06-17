import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { encryptFile, decryptFile } from '../services/cryptoService';
import { shredFile } from '../services/cleanupService';
import { scanFileBuffer } from '../services/virusScanService';
import { 
  createFileRecord, 
  getFileRecord, 
  incrementDownloadCount, 
  writeAuditLog, 
  getAuditLogs, 
  getAllActiveFiles 
} from '../services/databaseService';
import { 
  uploadEncryptedFile, 
  downloadEncryptedFile 
} from '../services/storageService';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, 
});

async function checkExpiration(file: any, ip: string): Promise<boolean> {
  if (file.isDeleted) return true;
  if (new Date() > new Date(file.expiresAt)) {
    await shredFile(file, 'ON_DEMAND_CHECK', 'File accessed after expiration; shredded on access.');
    return true;
  }
  return false;
}

router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const fileSize = req.file.size;

    // 1. Antivirus / Heuristics Check (ClamAV fallback)
    const scan = await scanFileBuffer(fileBuffer, originalName);
    if (scan.isInfected) {
      return res.status(400).json({ 
        error: `Security scan rejected file: malware signature detected (${scan.virusName}).` 
      });
    }

    const allowedExtensions = ['.pdf', '.zip', '.jpg', '.jpeg', '.png', '.txt', '.json', '.docx', '.xlsx', '.md'];
    const fileExt = path.extname(originalName).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      return res.status(400).json({ 
        error: `File format blocked. Allowed formats: ${allowedExtensions.join(', ')}` 
      });
    }

    const { password, burnOnRead } = req.body;
    const expireValue = parseInt(req.body.expireValue || '60', 10);
    const expireUnit = req.body.expireUnit || 'minutes'; 

    let expiresAt = new Date();
    if (expireUnit === 'minutes') {
      expiresAt.setMinutes(expiresAt.getMinutes() + expireValue);
    } else if (expireUnit === 'hours') {
      expiresAt.setHours(expiresAt.getHours() + expireValue);
    } else {
      expiresAt.setMinutes(expiresAt.getMinutes() + 60);
    }

    const maxExpiry = new Date();
    maxExpiry.setHours(maxExpiry.getHours() + 24);
    if (expiresAt > maxExpiry) {
      expiresAt = maxExpiry;
    }

    // 2. Argon2 Hashing
    let passwordHash: string | null = null;
    if (password && password.trim() !== '') {
      passwordHash = await argon2.hash(password);
    }

    const encryption = encryptFile(fileBuffer);
    const fileHash = uuidv4();
    
    // 3. Storage Upload (Firebase/Local)
    await uploadEncryptedFile(fileHash, encryption.ciphertext);

    // 4. DB Record Creation (Firestore/Sequelize)
    const fileRecord = await createFileRecord({
      fileName: originalName,
      fileHash: fileHash,
      passwordHash: passwordHash,
      encryptionKey: encryption.envelope,
      encryptionIv: encryption.iv,
      authTag: encryption.authTag,
      mimeType: mimeType,
      fileSize: fileSize,
      expiresAt: expiresAt,
      maxDownloads: (burnOnRead === 'true' || burnOnRead === true) ? 1 : null,
    });

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    await writeAuditLog({
      fileId: fileRecord.id,
      action: 'CREATED',
      ipAddress: ip,
      details: `File initialized with AES-256-GCM. Expiry: ${expiresAt.toISOString()}.`,
    });

    return res.status(201).json({
      uuid: fileRecord.id,
      expiresAt: fileRecord.expiresAt,
      burnOnRead: fileRecord.maxDownloads === 1,
    });
  } catch (error) {
    console.error('[UPLOAD] Error:', error);
    return res.status(500).json({ error: 'File processing and encryption failed.' });
  }
});

router.get('/challenge/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const file = await getFileRecord(uuid);

    if (!file) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const isExpired = await checkExpiration(file, ip);
    if (isExpired) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    return res.json({
      id: file.id,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      hasPassword: file.passwordHash !== null,
      burnOnRead: file.maxDownloads === 1,
    });
  } catch (error) {
    console.error('[CHALLENGE] Error:', error);
    return res.status(500).json({ error: 'Database retrieval error.' });
  }
});

router.post('/download/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const { password } = req.body;
    const file = await getFileRecord(uuid);

    if (!file) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const isExpired = await checkExpiration(file, ip);
    if (isExpired) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    if (file.passwordHash) {
      if (!password) {
        await writeAuditLog({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed download: Missing credentials.',
        });
        return res.status(401).json({ error: 'Password required.' });
      }

      // Argon2 password verification
      const match = await argon2.verify(file.passwordHash, password);
      if (!match) {
        await writeAuditLog({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed download: Invalid credentials submitted.',
        });
        return res.status(401).json({ error: 'Invalid password.' });
      }
    }

    // Download ciphertext from active storage
    let ciphertext: Buffer;
    try {
      ciphertext = await downloadEncryptedFile(file.fileHash);
    } catch (err) {
      await writeAuditLog({
        fileId: file.id,
        action: 'DOWNLOAD_FAIL',
        ipAddress: ip,
        details: 'Failed download: File payload missing in storage.',
      });
      return res.status(500).json({ error: 'Encrypted file chunk missing from storage.' });
    }

    const decrypted = decryptFile(
      ciphertext,
      file.encryptionKey,
      file.encryptionIv,
      file.authTag
    );

    await writeAuditLog({
      fileId: file.id,
      action: 'DOWNLOAD_SUCCESS',
      ipAddress: ip,
      details: 'File downloaded successfully.',
    });

    await incrementDownloadCount(file.id);

    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', decrypted.length);
    res.send(decrypted);

    // Burn on read check
    const nextCount = file.downloadCount + 1;
    if (file.maxDownloads && nextCount >= file.maxDownloads) {
      setTimeout(async () => {
        await shredFile(file, 'BURN_ON_READ', 'File shredded automatically after first download.');
      }, 1000);
    }
  } catch (error) {
    console.error('[DOWNLOAD] Error:', error);
    return res.status(500).json({ error: 'Decryption failed.' });
  }
});

router.get('/logs/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const logs = await getAuditLogs(uuid);

    if (logs.length === 0) {
      return res.status(404).json({ error: 'Audit history not found.' });
    }

    return res.json({ logs });
  } catch (error) {
    console.error('[LOGS] Error:', error);
    return res.status(500).json({ error: 'Database query failure.' });
  }
});

router.post('/nuke', async (req: Request, res: Response): Promise<any> => {
  try {
    const activeFiles = await getAllActiveFiles();

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    console.log(`[NUKE] Wipe initiated by IP ${ip}. Shredding ${activeFiles.length} items.`);

    for (const file of activeFiles) {
      await shredFile(file, ip, 'SYSTEM NUKE: All files shredded immediately.');
    }

    return res.json({ success: true, message: `System wiped. ${activeFiles.length} file shares shredded.` });
  } catch (error) {
    console.error('[NUKE] Error:', error);
    return res.status(500).json({ error: 'Nuke execution failed.' });
  }
});

export default router;
