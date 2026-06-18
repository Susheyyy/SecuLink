import { File, AuditLog, Message, sequelize } from '../models';
import { isFirebaseEnabled, getFirestoreDB } from './storageService';

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
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const fileId = data.id || require('uuid').v4();
    const docRef = db.collection('files').doc(fileId);
    
    const record = {
      id: fileId,
      fileName: data.fileName,
      fileHash: data.fileHash,
      passwordHash: data.passwordHash,
      encryptionKey: data.encryptionKey,
      encryptionIv: data.encryptionIv,
      authTag: data.authTag,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      expiresAt: adminTimestamp(data.expiresAt), 
      downloadCount: 0,
      maxDownloads: data.maxDownloads,
      isDeleted: false,
      createdAt: adminTimestamp(new Date()),
      updatedAt: adminTimestamp(new Date()),
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
    };
    
    await docRef.set(record);
    return { ...record, expiresAt: data.expiresAt };
  } else {
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
}

export async function getFileRecord(id: string): Promise<any | null> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const doc = await db.collection('files').doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.isDeleted) return { ...data, expiresAt: new Date(data.expiresAt.toDate()) };
    
    return {
      ...data,
      expiresAt: new Date(data.expiresAt.toDate()),
      otpExpiresAt: data.otpExpiresAt ? new Date(data.otpExpiresAt.toDate()) : null,
    };
  } else {
    const fileRecord = await File.findByPk(id);
    return fileRecord ? fileRecord.toJSON() : null;
  }
}

export async function redactFileRecord(id: string, originalName: string, reason: string): Promise<void> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const docRef = db.collection('files').doc(id);
    await docRef.update({
      fileName: 'REDACTED',
      isDeleted: true,
      updatedAt: adminTimestamp(new Date())
    });
  } else {
    const fileRecord = await File.findByPk(id);
    if (fileRecord) {
      fileRecord.fileName = 'REDACTED';
      fileRecord.isDeleted = true;
      await fileRecord.save();
    }
  }
}

export async function incrementDownloadCount(id: string): Promise<void> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const adminRef = require('firebase-admin');
    const docRef = db.collection('files').doc(id);
    await docRef.update({
      downloadCount: adminRef.firestore.FieldValue.increment(1),
      updatedAt: adminTimestamp(new Date())
    });
  } else {
    const fileRecord = await File.findByPk(id);
    if (fileRecord) {
      fileRecord.downloadCount += 1;
      await fileRecord.save();
    }
  }
}

export async function writeAuditLog(log: LogData): Promise<void> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const logId = require('uuid').v4();
    await db.collection('audit_logs').doc(logId).set({
      id: logId,
      fileId: log.fileId,
      action: log.action,
      ipAddress: log.ipAddress,
      details: log.details,
      createdAt: adminTimestamp(new Date())
    });
  } else {
    await AuditLog.create({
      fileId: log.fileId,
      action: log.action,
      ipAddress: log.ipAddress,
      details: log.details,
    });
  }
}

export async function getAuditLogs(fileId: string): Promise<any[]> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const snapshot = await db.collection('audit_logs')
      .where('fileId', '==', fileId)
      .orderBy('createdAt', 'asc')
      .get();
      
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        createdAt: new Date(data.createdAt.toDate())
      };
    });
  } else {
    const logs = await AuditLog.findAll({
      where: { fileId },
      order: [['createdAt', 'ASC']]
    });
    return logs.map(l => l.toJSON());
  }
}

export async function getActiveFilesForCleanup(nowDate: Date): Promise<FileData[]> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const snapshot = await db.collection('files')
      .where('expiresAt', '<=', adminTimestamp(nowDate))
      .where('isDeleted', '==', false)
      .get();
      
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        expiresAt: new Date(data.expiresAt.toDate())
      } as FileData;
    });
  } else {
    const expiredFiles = await File.findAll({
      where: {
        expiresAt: { [require('sequelize').Op.lte]: nowDate },
        isDeleted: false,
      },
    });
    return expiredFiles.map(f => f.toJSON() as FileData);
  }
}

export async function getAllActiveFiles(): Promise<FileData[]> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const snapshot = await db.collection('files')
      .where('isDeleted', '==', false)
      .get();
      
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        expiresAt: new Date(data.expiresAt.toDate())
      } as FileData;
    });
  } else {
    const active = await File.findAll({
      where: { isDeleted: false }
    });
    return active.map(f => f.toJSON() as FileData);
  }
}

export async function createChatMessage(data: { fileId: string; senderName: string; messageText: string; encryptionIv: string; authTag: string }): Promise<any> {
  const db = getFirestoreDB();
  if (isFirebaseEnabled() && db) {
    const msgId = require('uuid').v4();
    const docRef = db.collection('messages').doc(msgId);
    const record = {
      id: msgId,
      fileId: data.fileId,
      senderName: data.senderName,
      messageText: data.messageText,
      encryptionIv: data.encryptionIv,
      authTag: data.authTag,
      createdAt: adminTimestamp(new Date()),
    };
    await docRef.set(record);
    return record;
  } else {
    const msg = await Message.create({
      fileId: data.fileId,
      senderName: data.senderName,
      messageText: data.messageText,
      encryptionIv: data.encryptionIv,
      authTag: data.authTag,
    });
    return msg.toJSON();
  }
}

export async function getChatMessages(fileId: string): Promise<any[]> {
  const db = getFirestoreDB();
  if (isFirebaseEnabled() && db) {
    const snapshot = await db.collection('messages')
      .where('fileId', '==', fileId)
      .orderBy('createdAt', 'asc')
      .get();
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        createdAt: new Date(data.createdAt.toDate())
      };
    });
  } else {
    const msgs = await Message.findAll({
      where: { fileId },
      order: [['createdAt', 'ASC']]
    });
    return msgs.map(m => m.toJSON());
  }
}

export async function saveOtpCode(id: string, code: string, expiresAt: Date): Promise<void> {
  const db = getFirestoreDB();
  if (isFirebaseEnabled() && db) {
    const docRef = db.collection('files').doc(id);
    await docRef.update({
      otpCode: code,
      otpExpiresAt: adminTimestamp(expiresAt),
      updatedAt: adminTimestamp(new Date())
    });
  } else {
    const fileRecord = await File.findByPk(id);
    if (fileRecord) {
      fileRecord.otpCode = code;
      fileRecord.otpExpiresAt = expiresAt;
      await fileRecord.save();
    }
  }
}

function adminTimestamp(date: Date): any {
  const adminRef = require('firebase-admin');
  return adminRef.firestore.Timestamp.fromDate(date);
}
