import cron from 'node-cron';
import { Op } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { File, AuditLog } from '../models';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

export function initCleanupJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const expiredFiles = await File.findAll({
        where: {
          expiresAt: { [Op.lte]: now },
          isDeleted: false,
        },
      });

      if (expiredFiles.length === 0) return;

      console.log(`[SHREDDER] Found ${expiredFiles.length} expired files. Initializing cleanup.`);

      for (const file of expiredFiles) {
        await shredFile(file, 'SYSTEM_CRON', 'File expired automatically according to schedule.');
      }
    } catch (error) {
      console.error('[SHREDDER] Error during expired files cleanup job:', error);
    }
  });

  console.log('[SHREDDER] Expired files cleanup cron initialized (runs every 60s).');
}

export async function shredFile(file: File, triggerer: string, reason: string) {
  try {
    const filePath = path.join(UPLOADS_DIR, file.fileHash);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[SHREDDER] File unlinked from filesystem: ${filePath}`);
    } else {
      console.warn(`[SHREDDER] Encrypted file payload not found at: ${filePath}`);
    }

    const originalName = file.fileName;
    file.fileName = 'REDACTED';
    file.isDeleted = true;
    await file.save();

    await AuditLog.create({
      fileId: file.id,
      action: 'SHREDDED',
      ipAddress: triggerer,
      details: `${reason} (Original filename: ${originalName})`,
    });

    console.log(`[SHREDDER] Shredded file ${file.id} successfully.`);
  } catch (error) {
    console.error(`[SHREDDER] Error executing shredding on file ${file.id}:`, error);
  }
}
export { UPLOADS_DIR };
