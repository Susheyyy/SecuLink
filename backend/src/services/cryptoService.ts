import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const MASTER_SECRET = process.env.SECRET_KEY || 'seculink-default-super-secret-key-32chars!';

const getMasterKey = (): Buffer => {
  return crypto.createHash('sha256').update(MASTER_SECRET).digest();
};

export function encryptFile(fileBuffer: Buffer) {
  const fileKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12); 

  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey, iv);
  const ciphertext = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const masterKey = getMasterKey();
  const keyIv = crypto.randomBytes(16); 
  const keyCipher = crypto.createCipheriv('aes-256-cbc', masterKey, keyIv);
  const encryptedFileKey = Buffer.concat([keyCipher.update(fileKey), keyCipher.final()]);
  const envelope = Buffer.concat([keyIv, encryptedFileKey]).toString('hex');

  return {
    ciphertext,
    envelope,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

export function decryptFile(
  ciphertext: Buffer,
  envelopeHex: string,
  ivHex: string,
  authTagHex: string
): Buffer {
  const masterKey = getMasterKey();
  const envelope = Buffer.from(envelopeHex, 'hex');

  const keyIv = envelope.subarray(0, 16);
  const encryptedFileKey = envelope.subarray(16);
  
  const keyDecipher = crypto.createDecipheriv('aes-256-cbc', masterKey, keyIv);
  const fileKey = Buffer.concat([keyDecipher.update(encryptedFileKey), keyDecipher.final()]);

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}
