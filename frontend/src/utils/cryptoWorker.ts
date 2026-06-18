const workerCode = `
  self.onmessage = async (e) => {
    const { action, payload } = e.data;
    try {
      if (action === 'encrypt') {
        const { fileData, password, salt, iv } = payload;
        let key;
        
        if (password) {
          const enc = new TextEncoder();
          const baseKey = await self.crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
          );
          
          key = await self.crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: new Uint8Array(salt),
              iterations: 100000,
              hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt']
          );
        } else {
          key = await self.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt']
          );
        }

        let keyHex = '';
        if (!password) {
          const rawKey = await self.crypto.subtle.exportKey('raw', key);
          keyHex = Array.from(new Uint8Array(rawKey))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }

        const ciphertext = await self.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) },
          key,
          fileData
        );

        const fullEnc = new Uint8Array(ciphertext);
        const encryptedData = fullEnc.slice(0, -16);
        const authTag = fullEnc.slice(-16);

        self.postMessage({
          status: 'success',
          result: {
            ciphertext: encryptedData.buffer,
            authTag: Array.from(authTag),
            keyHex
          }
        }, [encryptedData.buffer]);
      } 
      
      else if (action === 'decrypt') {
        const { ciphertext, password, salt, iv, authTag, keyHex } = payload;
        let key;

        if (password) {
          const enc = new TextEncoder();
          const baseKey = await self.crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
          );

          key = await self.crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: new Uint8Array(salt),
              iterations: 100000,
              hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['decrypt']
          );
        } else {
          if (!keyHex) {
            throw new Error('Key hex is missing for decryption.');
          }
          const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
          key = await self.crypto.subtle.importKey(
            'raw',
            keyBytes,
            'AES-GCM',
            true,
            ['decrypt']
          );
        }

        const combined = new Uint8Array(ciphertext.byteLength + authTag.length);
        combined.set(new Uint8Array(ciphertext), 0);
        combined.set(new Uint8Array(authTag), ciphertext.byteLength);

        const decrypted = await self.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) },
          key,
          combined
        );

        self.postMessage({
          status: 'success',
          result: decrypted
        }, [decrypted]);
      }
    } catch (err) {
      self.postMessage({ status: 'error', error: err.message });
    }
  };
`;

let workerInstance: Worker | null = null;

export function getCryptoWorker(): Worker {
  if (!workerInstance) {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerInstance = new Worker(URL.createObjectURL(blob));
  }
  return workerInstance;
}

export function encryptInWorker(
  fileData: ArrayBuffer,
  password?: string,
  salt?: number[],
  iv?: number[]
): Promise<{ ciphertext: ArrayBuffer; authTag: number[]; keyHex: string }> {
  return new Promise((resolve, reject) => {
    const worker = getCryptoWorker();
    const activeIv = iv || Array.from(window.crypto.getRandomValues(new Uint8Array(12)));
    const activeSalt = salt || Array.from(window.crypto.getRandomValues(new Uint8Array(16)));

    const onMessage = (e: MessageEvent) => {
      if (e.data.status === 'success') {
        worker.removeEventListener('message', onMessage);
        resolve(e.data.result);
      } else {
        worker.removeEventListener('message', onMessage);
        reject(new Error(e.data.error || 'Encryption failed in Web Worker.'));
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({
      action: 'encrypt',
      payload: {
        fileData,
        password: password || null,
        salt: activeSalt,
        iv: activeIv
      }
    }, [fileData]);
  });
}

export function decryptInWorker(
  ciphertext: ArrayBuffer,
  password?: string,
  salt?: number[],
  iv?: number[],
  authTag?: number[],
  keyHex?: string
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = getCryptoWorker();
    
    const onMessage = (e: MessageEvent) => {
      if (e.data.status === 'success') {
        worker.removeEventListener('message', onMessage);
        resolve(e.data.result);
      } else {
        worker.removeEventListener('message', onMessage);
        reject(new Error(e.data.error || 'Decryption failed in Web Worker.'));
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({
      action: 'decrypt',
      payload: {
        ciphertext,
        password: password || null,
        salt: salt || null,
        iv: iv || null,
        authTag: authTag || null,
        keyHex: keyHex || null
      }
    }, [ciphertext]);
  });
}
