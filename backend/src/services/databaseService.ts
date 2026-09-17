import { File, AuditLog, Message, sequelize } from '../models';

export interface FileData {
  id?: string;
  fileName: string;
  fileHash: string;
  passwordHash: string | null;
  encryptionKey: string;
  encryptionIv: string;
  authTag: string;
  mimeType: string;
  fileSize: number;
  expiresAt: Date;
  downloadCount?: number;
  maxDownloads: number | null;
  isDeleted?: boolean;
  allowedIp?: string | null;
  notificationEmail?: string | null;
  isDirect?: boolean;
  allowedCountries?: string | null;
  accessWindowStart?: string | null;
  accessWindowEnd?: string | null;
  shareType?: string;
  cryptoSalt?: string | null;
  recipientEmail?: string | null;
  otpCode?: string | null;
  otpExpiresAt?: Date | null;
  viewOnly?: boolean;
}

export interface LogData {
  id?: string | number;
  fileId: string;
  action: string;
  ipAddress: string;
  details: string;
  createdAt?: Date;
}

export async function createFileRecord(data: FileData): Promise<any> {
  const fileRecord = await File.create({
    fileName: data.fileName,
    fileHash: data.fileHash,
    passwordHash: data.passwordHash,
    encryptionKey: data.encryptionKey,
    encryptionIv: data.encryptionIv,
    authTag: data.authTag,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    expiresAt: data.expiresAt,
    maxDownloads: data.maxDownloads,
    allowedIp: data.allowedIp || null,
    notificationEmail: data.notificationEmail || null,
    isDirect: data.isDirect || false,
    allowedCountries: data.allowedCountries || null,
    accessWindowStart: data.accessWindowStart || null,
    accessWindowEnd: data.accessWindowEnd || null,
    shareType: data.shareType || 'file',
    cryptoSalt: data.cryptoSalt || null,
    recipientEmail: data.recipientEmail || null,
    otpCode: null,
    otpExpiresAt: null,
    viewOnly: data.viewOnly || false,
  });
  return fileRecord.toJSON();
}

export async function getFileRecord(id: string): Promise<any | null> {
  const fileRecord = await File.findByPk(id);
  return fileRecord ? fileRecord.toJSON() : null;
}

export async function redactFileRecord(id: string, originalName: string, reason: string): Promise<void> {
  const fileRecord = await File.findByPk(id);
  if (fileRecord) {
    fileRecord.fileName = 'REDACTED';
    fileRecord.isDeleted = true;
    await fileRecord.save();
  }
}

export async function incrementDownloadCount(id: string): Promise<void> {
  const fileRecord = await File.findByPk(id);
  if (fileRecord) {
    fileRecord.downloadCount += 1;
    await fileRecord.save();
  }
}

export async function writeAuditLog(log: LogData): Promise<void> {
  await AuditLog.create({
    fileId: log.fileId,
    action: log.action,
    ipAddress: log.ipAddress,
    details: log.details,
  });
}

export async function getAuditLogs(fileId: string): Promise<any[]> {
  const logs = await AuditLog.findAll({
    where: { fileId },
    order: [['createdAt', 'ASC']]
  });
  return logs.map(l => l.toJSON());
}

export async function getActiveFilesForCleanup(nowDate: Date): Promise<FileData[]> {
  const expiredFiles = await File.findAll({
    where: {
      expiresAt: { [require('sequelize').Op.lte]: nowDate },
      isDeleted: false,
    },
  });
  return expiredFiles.map(f => f.toJSON() as FileData);
}

export async function getAllActiveFiles(): Promise<FileData[]> {
  const active = await File.findAll({
    where: { isDeleted: false }
  });
  return active.map(f => f.toJSON() as FileData);
}

export async function createChatMessage(data: { fileId: string; senderName: string; messageText: string; encryptionIv: string; authTag: string }): Promise<any> {
  const msg = await Message.create({
    fileId: data.fileId,
    senderName: data.senderName,
    messageText: data.messageText,
    encryptionIv: data.encryptionIv,
    authTag: data.authTag,
  });
  return msg.toJSON();
}

export async function getChatMessages(fileId: string): Promise<any[]> {
  const msgs = await Message.findAll({
    where: { fileId },
    order: [['createdAt', 'ASC']]
  });
  return msgs.map(m => m.toJSON());
}

export async function saveOtpCode(id: string, code: string, expiresAt: Date): Promise<void> {
  const fileRecord = await File.findByPk(id);
  if (fileRecord) {
    fileRecord.otpCode = code;
    fileRecord.otpExpiresAt = expiresAt;
    await fileRecord.save();
  }
}
