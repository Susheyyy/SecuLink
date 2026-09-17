import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config();

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

let s3Client: S3Client | null = null;
let s3BucketName = '';

function initializeS3() {
  const {
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET_NAME,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY
  } = process.env;

  if (S3_ENDPOINT && S3_REGION && S3_BUCKET_NAME && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
    try {
      s3Client = new S3Client({
        region: S3_REGION,
        endpoint: S3_ENDPOINT,
        credentials: {
          accessKeyId: S3_ACCESS_KEY_ID,
          secretAccessKey: S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      });
      s3BucketName = S3_BUCKET_NAME;
      console.log('[STORAGE] S3-compatible cloud storage initialized.');
    } catch (error) {
      console.warn('[STORAGE] Failed to initialize S3 client, falling back to local storage:', error);
    }
  } else {
    console.log('[STORAGE] S3 configuration missing. Storage: Local Filesystem.');
  }
}

initializeS3();

export function isCloudStorageEnabled(): boolean {
  return s3Client !== null;
}

export function getS3Client(): S3Client | null {
  return s3Client;
}

export function getS3BucketName(): string {
  return s3BucketName;
}

export async function uploadEncryptedFile(fileHash: string, ciphertext: Buffer): Promise<string> {
  if (s3Client) {
    const command = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: fileHash,
      Body: ciphertext,
      ContentType: 'application/octet-stream',
      Metadata: {
        encrypted: 'true',
        by: 'SecuLink'
      }
    });
    
    await s3Client.send(command);
    console.log(`[STORAGE] Encrypted payload uploaded to Cloud Storage: ${fileHash}`);
    return `s3://${s3BucketName}/${fileHash}`;
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
  if (s3Client) {
    const command = new GetObjectCommand({
      Bucket: s3BucketName,
      Key: fileHash
    });
    
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error('No body returned from S3');
    }
    
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
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
    if (s3Client) {
      const command = new DeleteObjectCommand({
        Bucket: s3BucketName,
        Key: fileHash
      });
      await s3Client.send(command);
      console.log(`[STORAGE] Deleted from Cloud Storage: ${fileHash}`);
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
  if (s3Client) {
    const command = new GetObjectCommand({
      Bucket: s3BucketName,
      Key: fileHash
    });
    
    const expiresInSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    return url;
  }
  
  return `http://localhost:${process.env.PORT || 5000}/api/vault/download-direct/${fileHash}`;
}
