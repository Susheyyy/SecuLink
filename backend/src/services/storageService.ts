import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let admin: any = null;
let bucket: any = null;
let useFirebase = false;

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

function initializeFirebase() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

  if (serviceAccountPath && bucketName && fs.existsSync(serviceAccountPath)) {
    try {
      admin = require('firebase-admin');
      const serviceAccount = require(path.resolve(serviceAccountPath));
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucketName
      });
      
      bucket = admin.storage().bucket();
      useFirebase = true;
      console.log('[STORAGE] Firebase Admin SDK initialized. Storage: Cloud Bucket.');
    } catch (error) {
      console.warn('[STORAGE] Failed to initialize Firebase Admin SDK, falling back to local storage:', error);
    }
  } else {
    console.log('[STORAGE] Firebase config missing or key file not found. Storage: Local Filesystem.');
  }
}

initializeFirebase();

export function isFirebaseEnabled(): boolean {
  return useFirebase;
}

export function getFirestoreDB(): any {
  if (useFirebase && admin) {
    return admin.firestore();
  }
  return null;
}

export async function uploadEncryptedFile(fileHash: string, ciphertext: Buffer): Promise<string> {
  if (useFirebase && bucket) {
    const file = bucket.file(fileHash);
    await file.save(ciphertext, {
      metadata: {
        contentType: 'application/octet-stream',
        metadata: {
          encrypted: 'true',
          by: 'SecuLink'
        }
      }
    });
    console.log(`[STORAGE] Encrypted payload uploaded to Firebase Storage: ${fileHash}`);
    return `firebase://${bucket.name}/${fileHash}`;
  } else {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const filePath = path.join(UPLOADS_DIR, fileHash);
    fs.writeFileSync(filePath, ciphertext);
    console.log(`[STORAGE] Encrypted payload saved locally: ${filePath}`);
    return `local://${filePath}`;
  }
}

export async function downloadEncryptedFile(fileHash: string): Promise<Buffer> {
  if (useFirebase && bucket) {
    const file = bucket.file(fileHash);
    const [content] = await file.download();
    return content;
  } else {
    const filePath = path.join(UPLOADS_DIR, fileHash);
    if (!fs.existsSync(filePath)) {
      throw new Error('Local file payload missing.');
    }
    return fs.readFileSync(filePath);
  }
}

export async function deleteFromStorage(fileHash: string): Promise<void> {
  try {
    if (useFirebase && bucket) {
      const file = bucket.file(fileHash);
      const [exists] = await file.exists();
      if (exists) {
        await file.delete();
        console.log(`[STORAGE] Deleted from Firebase Storage: ${fileHash}`);
      }
    } else {
      const filePath = path.join(UPLOADS_DIR, fileHash);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[STORAGE] Deleted local file payload: ${filePath}`);
      }
    }
  } catch (error) {
    console.error(`[STORAGE] Error deleting file payload ${fileHash}:`, error);
  }
}

export async function generateTemporaryDownloadUrl(fileHash: string, expiresAt: Date): Promise<string> {
  if (useFirebase && bucket) {
    const file = bucket.file(fileHash);
    
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: expiresAt
    });
    
    return url;
  }
  
  return `http://localhost:${process.env.PORT || 5000}/api/vault/download-direct/${fileHash}`;
}
