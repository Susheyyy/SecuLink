import { Router, Request, Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { File, AuditLog } from '../models';
import { encryptFile, decryptFile } from '../services/cryptoService';
import { shredFile, UPLOADS_DIR } from '../services/cleanupService';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, 
});

async function checkExpiration(file: File, ip: string): Promise<boolean> {
  if (file.isDeleted) return true;
  if (new Date() > file.expiresAt) {
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

    let passwordHash: string | null = null;
    if (password && password.trim() !== '') {
      passwordHash = await bcrypt.hash(password, 10);
    }
    const encryption = encryptFile(fileBuffer);

    const fileHash = uuidv4();
    const filePath = path.join(UPLOADS_DIR, fileHash);
    
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, encryption.ciphertext);

    const fileRecord = await File.create({
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
    await AuditLog.create({
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
    const file = await File.findByPk(uuid);

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
    const file = await File.findByPk(uuid);

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
        await AuditLog.create({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed download: Missing credentials.',
        });
        return res.status(401).json({ error: 'Password required.' });
      }

      const match = await bcrypt.compare(password, file.passwordHash);
      if (!match) {
        await AuditLog.create({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed download: Invalid credentials submitted.',
        });
        return res.status(401).json({ error: 'Invalid password.' });
      }
    }

    const filePath = path.join(UPLOADS_DIR, file.fileHash);
    if (!fs.existsSync(filePath)) {
      await AuditLog.create({
        fileId: file.id,
        action: 'DOWNLOAD_FAIL',
        ipAddress: ip,
        details: 'Failed download: Encryption payload missing on server.',
      });
      return res.status(500).json({ error: 'Encrypted file chunk missing from storage.' });
    }

    const ciphertext = fs.readFileSync(filePath);

    const decrypted = decryptFile(
      ciphertext,
      file.encryptionKey,
      file.encryptionIv,
      file.authTag
    );

    await AuditLog.create({
      fileId: file.id,
      action: 'DOWNLOAD_SUCCESS',
      ipAddress: ip,
      details: 'File downloaded successfully.',
    });

    file.downloadCount += 1;
    await file.save();

    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', decrypted.length);
    res.send(decrypted);

    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
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
    
    const logs = await AuditLog.findAll({
      where: { fileId: uuid },
      order: [['createdAt', 'ASC']],
    });

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
    const activeFiles = await File.findAll({
      where: { isDeleted: false }
    });

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    console.log(`[NUKE] Wipe initiated by IP ${ip}. Shredding ${activeFiles.length} items.`);

    for (const file of activeFiles) {
      await shredFile(file, ip, 'SYSTEM NUKE: All files shredded immediately.');
    }

    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      for (const file of files) {
        const filePath = path.join(UPLOADS_DIR, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
    }

    return res.json({ success: true, message: `System wiped. ${activeFiles.length} file streams shredded.` });
  } catch (error) {
    console.error('[NUKE] Error:', error);
    return res.status(500).json({ error: 'Nuke execution failed.' });
  }
});

export default router;
