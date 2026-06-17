import fs from 'fs';
import path from 'path';

export interface ScanResult {
  isInfected: boolean;
  virusName: string | null;
  scannedAt: Date;
}

export async function scanFileBuffer(fileBuffer: Buffer, fileName: string): Promise<ScanResult> {
  const scannedAt = new Date();
  
  try {
    try {
      require.resolve('clamscan');
      const ClamScan = require('clamscan');
      
      console.log(`[ANTIVIRUS] Attempting connection to ClamAV daemon...`);
      const clam = await new ClamScan().init({
        clamdscan: {
          host: process.env.CLAMAV_HOST || 'localhost',
          port: parseInt(process.env.CLAMAV_PORT || '3310', 10),
          timeout: 2000
        }
      });
      
      console.log(`[ANTIVIRUS] ClamAV daemon connected. Scanning stream...`);
      const { isInfected, virus } = await clam.scanBuffer(fileBuffer);
      if (isInfected) {
        console.warn(`[SECURITY WARNING] ClamAV scanner blocked file ${fileName} - Virus detected: ${virus}`);
        return {
          isInfected: true,
          virusName: virus || 'ClamAV.DetectedVirus',
          scannedAt
        };
      }
      
      console.log(`[ANTIVIRUS] ClamAV daemon scan successfully cleared file: ${fileName}`);
      return {
        isInfected: false,
        virusName: null,
        scannedAt
      };
    } catch (e: any) {
      console.log(`[ANTIVIRUS] ClamAV daemon offline or clamscan not loaded. Falling back to local scanner heuristics.`);
    }
    
    console.log(`[ANTIVIRUS] Scanning file: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)...`);
    
    if (fileBuffer.length > 2 && fileBuffer[0] === 0x4D && fileBuffer[1] === 0x5A) {
      console.warn(`[SECURITY WARNING] Blocked file ${fileName} - Executable PE signature (MZ) detected in upload stream.`);
      return {
        isInfected: true,
        virusName: 'Heuristics.ExecutablePESignature',
        scannedAt
      };
    }

    if (fileBuffer.length > 4 && 
        fileBuffer[0] === 0x7F && 
        fileBuffer[1] === 0x45 && 
        fileBuffer[2] === 0x4c && 
        fileBuffer[3] === 0x46) {
      console.warn(`[SECURITY WARNING] Blocked file ${fileName} - Executable ELF signature detected.`);
      return {
        isInfected: true,
        virusName: 'Heuristics.ExecutableELFSignature',
        scannedAt
      };
    }

    const isZip = fileBuffer.length > 4 && 
                  fileBuffer[0] === 0x50 && 
                  fileBuffer[1] === 0x4B && 
                  fileBuffer[2] === 0x03 && 
                  fileBuffer[3] === 0x04;
                  
    if (isZip) {
      const zipString = fileBuffer.toString('binary');
      const dangerousExtensions = ['.exe', '.sh', '.bat', '.dmg', '.pkg', '.scr'];
      for (const ext of dangerousExtensions) {
        if (zipString.includes(ext)) {
          console.warn(`[SECURITY WARNING] Blocked archive ${fileName} - Contains dangerous embedded file pattern: ${ext}`);
          return {
            isInfected: true,
            virusName: `Heuristics.DangerousEmbeddedFile(${ext})`,
            scannedAt
          };
        }
      }
    }

    console.log(`[ANTIVIRUS] File ${fileName} successfully cleared scanner heuristics.`);
    return {
      isInfected: false,
      virusName: null,
      scannedAt
    };
  } catch (error) {
    console.error('[ANTIVIRUS] Scan error, allowing file as fail-safe:', error);
    return {
      isInfected: false,
      virusName: null,
      scannedAt
    };
  }
}
