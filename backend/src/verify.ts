import { encryptFile, decryptFile } from './services/cryptoService';
import { sequelize, File } from './models';
import crypto from 'crypto';

async function runTests() {
  console.log('[TEST] Initializing cryptographic and database integrity test suite...');

  try {
    const originalText = 'SECULINK-TOP-SECRET-DATA-12345';
    const originalBuffer = Buffer.from(originalText, 'utf8');

    console.log('[TEST] Encrypting test buffer using AES-256-GCM...');
    const encrypted = encryptFile(originalBuffer);

    console.log('[TEST] Decrypting test buffer using envelope credentials...');
    const decrypted = decryptFile(
      encrypted.ciphertext,
      encrypted.envelope,
      encrypted.iv,
      encrypted.authTag
    );

    const decryptedText = decrypted.toString('utf8');
    if (decryptedText === originalText) {
      console.log('✔ Crypto Service Integrity: PASSED.');
    } else {
      throw new Error(`Decrypted text "${decryptedText}" does not match original "${originalText}"`);
    }

    await sequelize.authenticate();
    await sequelize.sync({ force: false });

    console.log('[TEST] Testing SQLite CRUD operations...');
    const testFile = await File.create({
      fileName: 'test-doc.pdf',
      fileHash: crypto.randomUUID(),
      passwordHash: 'mock-hash-value',
      encryptionKey: encrypted.envelope,
      encryptionIv: encrypted.iv,
      authTag: encrypted.authTag,
      mimeType: 'application/pdf',
      fileSize: originalBuffer.length,
      expiresAt: new Date(Date.now() + 1000 * 60), 
    });

    const retrieved = await File.findByPk(testFile.id);
    if (retrieved && retrieved.fileName === 'test-doc.pdf') {
      console.log('✔ SQLite Database Read/Write: PASSED.');
    } else {
      throw new Error('Retrieved database metadata does not match created record.');
    }

    await testFile.destroy();
    console.log('✔ Database Cleanup: PASSED.');

    console.log('\n ALL SECULINK AUTOMATED TESTS PASSED SUCCESSFULLY \n');
    process.exit(0);
  } catch (error) {
    console.error('✘ TEST CASCADE FAILED:', error);
    process.exit(1);
  }
}

runTests();
