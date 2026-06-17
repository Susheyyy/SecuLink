import { File, AuditLog, sequelize } from '../models';
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
}

export interface LogData {
  id?: string | number;
  fileId: string;
  action: string;
  ipAddress: string;
  details: string;
  createdAt?: Date;
}

/**
 * Save file metadata to Firestore or Sequelize SQLite database.
 */
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
      expiresAt: adminTimestamp(data.expiresAt), // For Firestore TTL
      downloadCount: 0,
      maxDownloads: data.maxDownloads,
      isDeleted: false,
      createdAt: adminTimestamp(new Date()),
      updatedAt: adminTimestamp(new Date())
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
    });
    return fileRecord.toJSON();
  }
}

/**
 * Retrieve metadata for a single file vault link.
 */
export async function getFileRecord(id: string): Promise<any | null> {
  const db = getFirestoreDB();
  
  if (isFirebaseEnabled() && db) {
    const doc = await db.collection('files').doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.isDeleted) return { ...data, expiresAt: new Date(data.expiresAt.toDate()) };
    
    return {
      ...data,
      expiresAt: new Date(data.expiresAt.toDate())
    };
  } else {
    const fileRecord = await File.findByPk(id);
    return fileRecord ? fileRecord.toJSON() : null;
  }
}

/**
 * Redact metadata (ephemeral metadata principle).
 */
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

/**
 * Increment successful downloads log counter.
 */
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

/**
 * Log transactions audit trail.
 */
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

/**
 * Fetch logs for a specific share link.
 */
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

/**
 * Retrieve all active files (not shredded) for cleanup.
 */
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

/**
 * Retrieve all active files on server.
 */
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

/**
 * Helper to generate firebase-admin firestore timestamp objects safely.
 */
function adminTimestamp(date: Date): any {
  const adminRef = require('firebase-admin');
  return adminRef.firestore.Timestamp.fromDate(date);
}
