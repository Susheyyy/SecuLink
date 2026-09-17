import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import http from 'http';
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
  getAllActiveFiles,
  createChatMessage,
  getChatMessages,
  saveOtpCode
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

async function getCountryFromIp(ip: string): Promise<string> {
  const cleanIp = ip.replace(/^::ffff:/, '');
  if (
    cleanIp === '127.0.0.1' || 
    cleanIp === '::1' || 
    cleanIp === 'localhost' || 
    cleanIp.startsWith('192.168.') || 
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('172.16.')
  ) {
    return 'US'; 
  }
  
  return new Promise((resolve) => {
    const req = http.get(`http://ip-api.com/json/${cleanIp}`, { timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.countryCode || 'US');
        } catch {
          resolve('US');
        }
      });
    });
    
    req.on('error', () => resolve('US'));
    req.on('timeout', () => {
      req.destroy();
      resolve('US');
    });
    req.end();
  });
}

function checkCountryRestriction(allowedCountries: string | null, clientCountry: string): boolean {
  if (!allowedCountries || allowedCountries.trim() === '') return true;
  const list = allowedCountries.split(',').map(c => c.trim().toUpperCase());
  return list.includes(clientCountry.toUpperCase());
}

function checkTimeWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return true;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

async function checkExpiration(file: any, ip: string): Promise<boolean> {
  if (file.isDeleted) return true;
  if (new Date() > new Date(file.expiresAt)) {
    await shredFile(file, 'ON_DEMAND_CHECK', 'File accessed after expiration; shredded on access.');
    return true;
  }
  return false;
}

async function validateConstraints(file: any, req: Request): Promise<{ allowed: boolean; error?: string; status?: number }> {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  
  const isExpired = await checkExpiration(file, ip);
  if (isExpired) {
    return { allowed: false, error: 'Link not found or expired.', status: 404 };
  }

  if (!checkIpRestriction(file.allowedIp, ip)) {
    await writeAuditLog({
      fileId: file.id,
      action: 'ACCESS_DENIED',
      ipAddress: ip,
      details: `Access denied: Client IP ${ip} does not match allowed IP restriction (${file.allowedIp}).`,
    });
    return { allowed: false, error: 'Access denied: Restricted recipient IP only.', status: 403 };
  }

  const country = await getCountryFromIp(ip);
  if (!checkCountryRestriction(file.allowedCountries, country)) {
    await writeAuditLog({
      fileId: file.id,
      action: 'ACCESS_DENIED',
      ipAddress: ip,
      details: `Access denied: Country ${country} not in allowed geofence restriction (${file.allowedCountries}).`,
    });
    return { allowed: false, error: 'Access denied: Restricted geographic area only.', status: 403 };
  }

  if (!checkTimeWindow(file.accessWindowStart, file.accessWindowEnd)) {
    await writeAuditLog({
      fileId: file.id,
      action: 'ACCESS_DENIED',
      ipAddress: ip,
      details: `Access denied: Current time is outside allowed download window (${file.accessWindowStart} - ${file.accessWindowEnd}).`,
    });
    return { allowed: false, error: 'Access denied: Download window is currently closed.', status: 403 };
  }

  return { allowed: true };
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

    const { 
      password, 
      burnOnRead, 
      allowedIp, 
      notificationEmail,
      allowedCountries,
      accessWindowStart,
      accessWindowEnd,
      shareType,
      cryptoSalt,
      recipientEmail,
      viewOnly
    } = req.body;
    
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

    const isDirectZeroKnowledge = (req.body.isDirectZeroKnowledge === 'true' || req.body.isDirectZeroKnowledge === true);
    
    let ciphertext: Buffer;
    let encryptionKey: string;
    let encryptionIv: string;
    let authTag: string;

    if (isDirectZeroKnowledge) {
      ciphertext = fileBuffer;
      encryptionKey = req.body.encryptionKey;
      encryptionIv = req.body.encryptionIv;
      authTag = req.body.authTag;
    } else {
      const encryption = encryptFile(fileBuffer);
      ciphertext = encryption.ciphertext;
      encryptionKey = encryption.envelope;
      encryptionIv = encryption.iv;
      authTag = encryption.authTag;
    }
    
    const fileHash = uuidv4();
    await uploadEncryptedFile(fileHash, ciphertext);

    const fileRecord = await createFileRecord({
      fileName: originalName,
      fileHash: fileHash,
      passwordHash: passwordHash,
      encryptionKey: encryptionKey,
      encryptionIv: encryptionIv,
      authTag: authTag,
      mimeType: mimeType,
      fileSize: fileSize,
      expiresAt: expiresAt,
      maxDownloads: (burnOnRead === 'true' || burnOnRead === true) ? 1 : null,
      allowedIp: allowedIp || null,
      notificationEmail: notificationEmail || null,
      isDirect: false,
      allowedCountries: allowedCountries || null,
      accessWindowStart: accessWindowStart || null,
      accessWindowEnd: accessWindowEnd || null,
      shareType: shareType || 'file',
      cryptoSalt: cryptoSalt || null,
      recipientEmail: recipientEmail || null,
      viewOnly: (viewOnly === 'true' || viewOnly === true)
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
      fileHash,
      allowedCountries,
      accessWindowStart,
      accessWindowEnd,
      shareType,
      cryptoSalt,
      recipientEmail,
      viewOnly
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

    const { isCloudStorageEnabled, getS3Client, getS3BucketName } = require('../services/storageService');
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    let uploadUrl = '';

    if (isCloudStorageEnabled()) {
      const s3Client = getS3Client();
      const bucketName = getS3BucketName();
      
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileHash,
        ContentType: 'application/octet-stream'
      });
      
      uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 15 * 60 });
    } else {
      uploadUrl = `http://localhost:${process.env.PORT || 5000}/api/vault/direct-upload/${fileHash}`;
    }

    const fileRecord = await createFileRecord({
      fileName: fileName,
      fileHash: fileHash,
      passwordHash: passwordHash,
      encryptionKey: encryptionKey, 
      encryptionIv: encryptionIv,
      authTag: authTag,
      mimeType: mimeType || 'application/octet-stream',
      fileSize: parseInt(fileSize || '0', 10),
      expiresAt: expiresAt,
      maxDownloads: (burnOnRead === 'true' || burnOnRead === true) ? 1 : null,
      allowedIp: allowedIp || null,
      notificationEmail: notificationEmail || null,
      isDirect: true,
      allowedCountries: allowedCountries || null,
      accessWindowStart: accessWindowStart || null,
      accessWindowEnd: accessWindowEnd || null,
      shareType: shareType || 'file',
      cryptoSalt: cryptoSalt || null,
      recipientEmail: recipientEmail || null,
      viewOnly: (viewOnly === 'true' || viewOnly === true)
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
      isCloudStorage: isCloudStorageEnabled()
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

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const cleanIp = ip.replace(/^::ffff:/, '');

    return res.json({
      id: file.id,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      hasPassword: file.passwordHash !== null,
      burnOnRead: file.maxDownloads === 1,
      shareType: file.shareType || 'file',
      cryptoSalt: file.cryptoSalt || null,
      encryptionIv: file.encryptionIv,
      authTag: file.authTag,
      recipientEmail: file.recipientEmail || null,
      viewOnly: file.viewOnly || false,
      clientIp: cleanIp
    });
  } catch (error) {
    console.error('[CHALLENGE] Error:', error);
    return res.status(500).json({ error: 'Database retrieval error.' });
  }
});

router.post('/otp-request/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const file = await getFileRecord(uuid);
    if (!file) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    if (!file.recipientEmail) {
      return res.status(400).json({ error: 'Email verification is not enabled for this share.' });
    }

    if (email.trim().toLowerCase() !== file.recipientEmail.trim().toLowerCase()) {
      await writeAuditLog({
        fileId: file.id,
        action: 'ACCESS_DENIED',
        ipAddress: ip,
        details: `OTP request rejected: Email ${email} does not match allowed recipient address (${file.recipientEmail}).`,
      });
      return res.status(403).json({ error: 'Access denied: Email address does not match allowed recipient.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); 
    await saveOtpCode(file.id, code, expiresAt);

    try {
      await sendNotificationEmail(
        email.trim(),
        'DOWNLOAD_SUCCESS', 
        file.fileName,
        ip,
        `Your SecuLink verification code is: ${code}. Valid for 5 minutes. Enter this code on the verification challenge page to access the secure contents.`
      );
    } catch (mailErr) {
      console.error('[OTP EMAIL] NodeMailer failed to send verification code:', mailErr);
    }

    await writeAuditLog({
      fileId: file.id,
      action: 'OTP_SENT',
      ipAddress: ip,
      details: `OTP access verification code successfully sent to: ${email}.`,
    });

    return res.json({ success: true, message: 'Verification code sent.' });
  } catch (error) {
    console.error('[OTP REQUEST ERROR]', error);
    return res.status(500).json({ error: 'Failed to request verification code.' });
  }
});

router.post('/otp-verify/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email address and code are required.' });
    }

    const file = await getFileRecord(uuid);
    if (!file) {
      return res.status(404).json({ error: 'Link not found or expired.' });
    }

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    if (!file.recipientEmail) {
      return res.status(400).json({ error: 'Email verification is not enabled for this share.' });
    }

    if (email.trim().toLowerCase() !== file.recipientEmail.trim().toLowerCase()) {
      return res.status(403).json({ error: 'Email address does not match allowed recipient.' });
    }

    if (!file.otpCode || file.otpCode !== code) {
      await writeAuditLog({
        fileId: file.id,
        action: 'ACCESS_DENIED',
        ipAddress: ip,
        details: `OTP challenge failed: Invalid verification code submitted.`,
      });
      return res.status(401).json({ error: 'Invalid verification code.' });
    }

    if (!file.otpExpiresAt || new Date() > new Date(file.otpExpiresAt)) {
      await writeAuditLog({
        fileId: file.id,
        action: 'ACCESS_DENIED',
        ipAddress: ip,
        details: `OTP challenge failed: Verification code has expired.`,
      });
      return res.status(401).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    await writeAuditLog({
      fileId: file.id,
      action: 'OTP_VERIFIED',
      ipAddress: ip,
      details: `OTP access verification code successfully verified for: ${email}.`,
    });

    return res.json({ success: true, verified: true });
  } catch (error) {
    console.error('[OTP VERIFY ERROR]', error);
    return res.status(500).json({ error: 'Failed to verify verification code.' });
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

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    if (file.passwordHash) {
      if (!password) {
        await writeAuditLog({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed access: Missing credentials.',
        });
        return res.status(401).json({ error: 'Password required.' });
      }

      const match = await argon2.verify(file.passwordHash, password);
      if (!match) {
        await writeAuditLog({
          fileId: file.id,
          action: 'DOWNLOAD_FAIL',
          ipAddress: ip,
          details: 'Failed access: Invalid credentials submitted.',
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
        details: 'Failed access: File payload missing in storage.',
      });
      return res.status(500).json({ error: 'Encrypted file chunk missing from storage.' });
    }

    await writeAuditLog({
      fileId: file.id,
      action: 'DOWNLOAD_SUCCESS',
      ipAddress: ip,
      details: 'Encrypted payload served for client-side decryption.',
    });

    if (file.notificationEmail && file.notificationEmail.trim() !== '') {
      try {
        await sendNotificationEmail(
          file.notificationEmail,
          'DOWNLOAD_SUCCESS',
          file.fileName,
          ip,
          'Uploader notified: Link accessed and encrypted payload served successfully.'
        );
      } catch (mailErr) {
        console.error('[DOWNLOAD] Email dispatch failed on success:', mailErr);
      }
    }

    await incrementDownloadCount(file.id);

    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}.enc"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', ciphertext.length);
    res.send(ciphertext);

    const nextCount = file.downloadCount + 1;
    if (file.maxDownloads && nextCount >= file.maxDownloads) {
      setTimeout(async () => {
        await shredFile(file, 'BURN_ON_READ', 'File shredded automatically after first download.');
      }, 1000);
    }
  } catch (error) {
    console.error('[DOWNLOAD] Error:', error);
    return res.status(500).json({ error: 'File transfer failed.' });
  }
});

router.post('/chat-logs/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const { password } = req.body;
    const file = await getFileRecord(uuid);

    if (!file) {
      return res.status(404).json({ error: 'Chat not found or expired.' });
    }

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    if (file.passwordHash) {
      if (!password) {
        return res.status(401).json({ error: 'Password required.' });
      }
      const match = await argon2.verify(file.passwordHash, password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid password.' });
      }
    }

    const messages = await getChatMessages(file.id);
    return res.json({ messages });
  } catch (error) {
    console.error('[CHAT GET] Error:', error);
    return res.status(500).json({ error: 'Failed to retrieve secure chat logs.' });
  }
});

router.post('/chat-send/:uuid', async (req: Request, res: Response): Promise<any> => {
  try {
    const { uuid } = req.params;
    const { password, senderName, messageText, encryptionIv, authTag } = req.body;

    if (!senderName || !messageText || !encryptionIv || !authTag) {
      return res.status(400).json({ error: 'Missing encrypted message components.' });
    }

    const file = await getFileRecord(uuid);
    if (!file) {
      return res.status(404).json({ error: 'Chat not found or expired.' });
    }

    const validation = await validateConstraints(file, req);
    if (!validation.allowed) {
      return res.status(validation.status || 403).json({ error: validation.error });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    if (file.passwordHash) {
      if (!password) {
        return res.status(401).json({ error: 'Password required.' });
      }
      const match = await argon2.verify(file.passwordHash, password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid password.' });
      }
    }

    const messageRecord = await createChatMessage({
      fileId: file.id,
      senderName,
      messageText,
      encryptionIv,
      authTag
    });

    await writeAuditLog({
      fileId: file.id,
      action: 'CHAT_POST',
      ipAddress: ip,
      details: 'Encrypted message successfully appended to secure thread.',
    });

    return res.status(201).json({ success: true, message: messageRecord });
  } catch (error) {
    console.error('[CHAT POST] Error:', error);
    return res.status(500).json({ error: 'Failed to transmit encrypted message.' });
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
