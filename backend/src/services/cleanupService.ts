import cron from 'node-cron';
import { getActiveFilesForCleanup, redactFileRecord, writeAuditLog } from './databaseService';
import { deleteFromStorage } from './storageService';

export function initCleanupJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const expiredFiles = await getActiveFilesForCleanup(now);

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

export async function shredFile(
  file: { id?: string; fileHash: string; fileName: string }, 
  triggerer: string, 
  reason: string
) {
  try {
    await deleteFromStorage(file.fileHash);

    const originalName = file.fileName;
    if (file.id) {
      await redactFileRecord(file.id, originalName, reason);

      await writeAuditLog({
        fileId: file.id,
        action: 'SHREDDED',
        ipAddress: triggerer,
        details: `${reason} (Original filename: ${originalName})`,
      });

      console.log(`[SHREDDER] Shredded file ${file.id} successfully.`);
    }
  } catch (error) {
    console.error(`[SHREDDER] Error executing shredding on file ${file.id}:`, error);
  }
}
export const UPLOADS_DIR = require('path').join(__dirname, '../../uploads');
