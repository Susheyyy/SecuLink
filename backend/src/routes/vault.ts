import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { encryptFile, decryptFile, encryptFileKey } from '../services/cryptoService';
import { shredFile } from '../services/cleanupService';
import { scanFileBuffer } from '../services/virusScanService';
import { sendNotificationEmail } from '../services/emailService';
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

function checkIpRestriction(allowedIp: string | null, clientIp: string): boolean {
  if (!allowedIp || allowedIp.trim() === '') return true;
  const allowed = allowedIp.trim();
  
  const cleanClient = clientIp.replace(/^::ffff:/, '');
  const cleanAllowed = allowed.replace(/^::ffff:/, '');
  
  return cleanClient === cleanAllowed || clientIp === allowed || clientIp.includes(allowed);
}

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

    const { password, burnOnRead, allowedIp, notificationEmail } = req.body;
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
      passwordHash = await argon2.hash(password);
    }

    const encryption = encryptFile(fileBuffer);
    const fileHash = uuidv4();
    
    await uploadEncryptedFile(fileHash, encryption.ciphertext);

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
      allowedIp: allowedIp || null,
      notificationEmail: notificationEmail || null,
      isDirect: false,
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

router.post('/signed-upload-url', async (req: Request, res: Response): Promise<any> => {
  try {
    const { 
      fileName, 
      mimeType, 
      fileSize, 
      password, 
      burnOnRead, 
      allowedIp, 
      notificationEmail,
      encryptionKey,
      encryptionIv,
      authTag,
      fileHash
    } = req.body;

    if (!fileName || !fileHash || !encryptionKey || !encryptionIv || !authTag) {
      return res.status(400).json({ error: 'Missing encryption parameters or filename.' });
    }

    const allowedExtensions = ['.pdf', '.zip', '.jpg', '.jpeg', '.png', '.txt', '.json', '.docx', '.xlsx', '.md'];
    const fileExt = path.extname(fileName).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      return res.status(400).json({ 
        error: `File format blocked. Allowed formats: ${allowedExtensions.join(', ')}` 
      });
    }

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
      passwordHash = await argon2.hash(password);
    }

    const { isFirebaseEnabled, getStorageBucket } = require('../services/storageService');
    let uploadUrl = '';

    if (isFirebaseEnabled()) {
      const bucket = getStorageBucket();
      const fileRef = bucket.file(fileHash);
      const [url] = await fileRef.getSignedUrl({
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: 'application/octet-stream'
      });
      uploadUrl = url;
    } else {
      uploadUrl = `http://localhost:${process.env.PORT || 5000}/api/vault/direct-upload/${fileHash}`;
    }

    const fileRecord = await createFileRecord({
      fileName: fileName,
      fileHash: fileHash,
      passwordHash: passwordHash,
      encryptionKey: encryptFileKey(Buffer.from(encryptionKey, 'hex')),
      encryptionIv: encryptionIv,
      authTag: authTag,
      mimeType: mimeType || 'application/octet-stream',
      fileSize: parseInt(fileSize || '0', 10),
      expiresAt: expiresAt,
      maxDownloads: (burnOnRead === 'true' || burnOnRead === true) ? 1 : null,
      allowedIp: allowedIp || null,
      notificationEmail: notificationEmail || null,
      isDirect: true
    });

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    await writeAuditLog({
      fileId: fileRecord.id,
      action: 'CREATED_DIRECT',
      ipAddress: ip,
      details: `Direct upload presigned URL generated. Expiry: ${expiresAt.toISOString()}.`,
    });

    return res.status(200).json({
      uuid: fileRecord.id,
      expiresAt: fileRecord.expiresAt,
      uploadUrl: uploadUrl,
      isFirebase: isFirebaseEnabled()
    });
  } catch (error) {
    console.error('[SIGNED UPLOAD] Error:', error);
    return res.status(500).json({ error: 'Failed to generate signed upload URL.' });
  }
});

router.put('/direct-upload/:fileHash', async (req: Request, res: Response): Promise<any> => {
  try {
    const { fileHash } = req.params;
    const UPLOADS_DIR = path.join(__dirname, '../../uploads');
    
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const filePath = path.join(UPLOADS_DIR, fileHash);
    const writeStream = fs.createWriteStream(filePath);
    
    req.pipe(writeStream);

    req.on('error', (err) => {
      console.error('[DIRECT UPLOAD] Request stream error:', err);
      res.status(500).json({ error: 'Upload stream interrupted.' });
    });

    writeStream.on('error', (err) => {
      console.error('[DIRECT UPLOAD] Disk write error:', err);
      res.status(500).json({ error: 'Failed to write upload payload to disk.' });
    });

    writeStream.on('finish', () => {
      console.log(`[STORAGE] Direct payload saved locally via stream: ${filePath}`);
      res.status(200).json({ success: true });
    });
  } catch (error) {
    console.error('[DIRECT UPLOAD] Server error:', error);
    res.status(500).json({ error: 'Direct upload execution failed.' });
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

    if (!checkIpRestriction(file.allowedIp, ip)) {
      await writeAuditLog({
        fileId: file.id,
        action: 'ACCESS_DENIED',
        ipAddress: ip,
        details: `Access denied: Client IP ${ip} does not match allowed IP restriction (${file.allowedIp}).`,
      });
      return res.status(403).json({ error: 'Access denied: Restricted recipient IP only.' });
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

    if (!checkIpRestriction(file.allowedIp, ip)) {
      await writeAuditLog({
        fileId: file.id,
        action: 'ACCESS_DENIED',
        ipAddress: ip,
        details: `Access denied: Client IP ${ip} does not match allowed IP restriction (${file.allowedIp}).`,
      });
      return res.status(403).json({ error: 'Access denied: Restricted recipient IP only.' });
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

    if (file.notificationEmail && file.notificationEmail.trim() !== '') {
      try {
        await sendNotificationEmail(
          file.notificationEmail,
          'DOWNLOAD_SUCCESS',
          file.fileName,
          ip,
          'Uploader notified: Link accessed and file successfully downloaded.'
        );
      } catch (mailErr) {
        console.error('[DOWNLOAD] Email dispatch failed on success:', mailErr);
      }
    }

    await incrementDownloadCount(file.id);

    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', decrypted.length);
    res.send(decrypted);

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
