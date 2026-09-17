import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, ShieldAlert, Key, RefreshCw, AlertTriangle, FileCheck, Clock, Copy, Send, User } from 'lucide-react';
import { decryptInWorker } from '../utils/cryptoWorker';

interface DownloadChallengeProps {
  uuid: string;
  onBackToDashboard: () => void;
}

interface FileMetadata {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  expiresAt: string;
  hasPassword: boolean;
  burnOnRead: boolean;
  shareType: string; 
  cryptoSalt: string | null;
  encryptionIv: string;
  authTag: string;
  recipientEmail: string | null;
  viewOnly: boolean;
  clientIp: string;
}

interface ChatMessage {
  id: string;
  senderName: string; 
  messageText: string;
  encryptionIv: string;
  authTag: string;
  createdAt: string;
  decryptedSender?: string;
  decryptedText?: string;
}

async function getSubtleKey(password: string | null, saltHex: string | null, keyHex: string | null): Promise<CryptoKey> {
  if (password && saltHex) {
    const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const enc = new TextEncoder();
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: Math.max(1, saltBytes.length) ? saltBytes : new Uint8Array(16),
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  } else if (keyHex) {
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    return await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      'AES-GCM',
      true,
      ['encrypt', 'decrypt']
    );
  }
  throw new Error('Access credential missing from URL hash or password form.');
}

async function encryptText(text: string, key: CryptoKey): Promise<{ ciphertextHex: string; ivHex: string; authTagHex: string }> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  
  const fullEnc = new Uint8Array(encrypted);
  const ciphertext = fullEnc.slice(0, -16);
  const authTag = fullEnc.slice(-16);
  
  const toHex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return {
    ciphertextHex: toHex(ciphertext),
    ivHex: toHex(iv),
    authTagHex: toHex(authTag)
  };
}

async function decryptText(ciphertextHex: string, ivHex: string, authTagHex: string, key: CryptoKey): Promise<string> {
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cipher = fromHex(ciphertextHex);
  const iv = fromHex(ivHex);
  const authTag = fromHex(authTagHex);
  
  const combined = new Uint8Array(cipher.length + authTag.length);
  combined.set(cipher, 0);
  combined.set(authTag, cipher.length);
  
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined
  );
  
  return new TextDecoder().decode(decrypted);
}

export const DownloadChallenge: React.FC<DownloadChallengeProps> = ({ uuid, onBackToDashboard }) => {
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState('');

  const [activeKey, setActiveKey] = useState<CryptoKey | null>(null);
  const [rawKeyHex, setRawKeyHex] = useState('');

  const [noteText, setNoteText] = useState('');
  const [noteCopied, setNoteCopied] = useState(false);

  const [isChatUnlocked, setIsChatUnlocked] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [senderNickname, setSenderNickname] = useState('Recipient');
  const [typedMessage, setTypedMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatPollRef = useRef<number | null>(null);

  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const fetchChallengeInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://localhost:5000/api/vault/challenge/${uuid}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Vault slug is voided or expired.');
      }
      const data = await response.json();
      setMeta(data);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to establish host handshake.');
    } finally {
      setLoading(false);
    }
  }, [uuid]);

  const fetchChatLogs = useCallback(async () => {
    if (!meta || !activeKey) return;
    try {
      const passVal = password.trim() ? password : null;
      const response = await fetch(`http://localhost:5000/api/vault/chat-logs/${uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passVal }),
      });

      if (!response.ok) return;

      const data = await response.json();
      const rawMsgs: ChatMessage[] = data.messages;

      const decryptedMsgs = await Promise.all(
        rawMsgs.map(async (msg) => {
          try {
            const sender = await decryptText(msg.senderName, msg.encryptionIv, msg.authTag, activeKey);
            const text = await decryptText(msg.messageText, msg.encryptionIv, msg.authTag, activeKey);
            return {
              ...msg,
              decryptedSender: sender,
              decryptedText: text
            };
          } catch {
            return {
              ...msg,
              decryptedSender: 'Decryption Error',
              decryptedText: '[Encrypted payload could not be decrypted]'
            };
          }
        })
      );

      setChatMessages(decryptedMsgs);
    } catch (err) {
      console.error('[CHAT POLL ERROR]', err);
    }
  }, [meta, activeKey, password, uuid]);

  useEffect(() => {
    const hashParts = window.location.hash.split('#');
    if (hashParts[2] && hashParts[2].length === 64) {

      setRawKeyHex(hashParts[2]);
    }
  }, []);

  useEffect(() => {

    fetchChallengeInfo();
  }, [uuid, fetchChallengeInfo]);

  useEffect(() => {
    if (!meta) return;
    
    const updateCountdown = () => {
      const expiry = new Date(meta.expiresAt).getTime();
      const now = new Date().getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeRemaining('EXPIRED');
        setError('Vault lease expired while on page.');
      } else {
        const hrs = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        
        let timeStr = '';
        if (hrs > 0) timeStr += `${hrs}h `;
        timeStr += `${mins}m ${secs}s`;
        setTimeRemaining(timeStr);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [meta]);

  useEffect(() => {
    if (isChatUnlocked && meta && meta.shareType === 'chat') {
      fetchChatLogs();
      chatPollRef.current = window.setInterval(fetchChatLogs, 3000);
    }
    return () => {
      if (chatPollRef.current) window.clearInterval(chatPollRef.current);
    };
  }, [isChatUnlocked, fetchChatLogs, meta]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (meta?.viewOnly && downloadSuccess) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          (e.ctrlKey && (e.key === 'c' || e.key === 's' || e.key === 'p' || e.key === 'a')) ||
          e.key === 'PrintScreen'
        ) {
          e.preventDefault();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [meta, downloadSuccess]);

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const response = await fetch(`http://localhost:5000/api/vault/otp-request/${uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code.');
      }
      setOtpSent(true);
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : String(err));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const response = await fetch(`http://localhost:5000/api/vault/otp-verify/${uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail, code: otpCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Invalid verification code.');
      }
      setIsOtpVerified(true);
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : String(err));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;

    setDownloading(true);
    setDownloadError(null);

    try {
      const passVal = password.trim() ? password : null;
      const key = await getSubtleKey(passVal, meta.cryptoSalt, rawKeyHex || null);
      setActiveKey(key);

      if (meta.shareType === 'note') {
        const response = await fetch(`http://localhost:5000/api/vault/download/${uuid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passVal }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Authentication challenge failed.');
        }

        const encryptedBlob = await response.blob();
        const encryptedBuffer = await encryptedBlob.arrayBuffer();

        const fromHex = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const ivBytes = fromHex(meta.encryptionIv);
        const authTagBytes = fromHex(meta.authTag);
        const saltBytes = meta.cryptoSalt ? fromHex(meta.cryptoSalt) : new Uint8Array(16);

        const decryptedBuffer = await decryptInWorker(
          encryptedBuffer,
          passVal || undefined,
          Array.from(saltBytes),
          Array.from(ivBytes),
          Array.from(authTagBytes),
          rawKeyHex || undefined
        );

        const text = new TextDecoder().decode(decryptedBuffer);
        setNoteText(text);
        setDownloadSuccess(true);
      } 
      
      else if (meta.shareType === 'chat') {
        const response = await fetch(`http://localhost:5000/api/vault/chat-logs/${uuid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passVal }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Authentication challenge failed.');
        }

        setIsChatUnlocked(true);
      } 
      
      else {
        const response = await fetch(`http://localhost:5000/api/vault/download/${uuid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passVal }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to authenticate download.');
        }

        const encryptedBlob = await response.blob();
        const encryptedBuffer = await encryptedBlob.arrayBuffer();

        const fromHex = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const ivBytes = fromHex(meta.encryptionIv);
        const authTagBytes = fromHex(meta.authTag);
        const saltBytes = meta.cryptoSalt ? fromHex(meta.cryptoSalt) : new Uint8Array(16);

        const decryptedBuffer = await decryptInWorker(
          encryptedBuffer,
          passVal || undefined,
          Array.from(saltBytes),
          Array.from(ivBytes),
          Array.from(authTagBytes),
          rawKeyHex || undefined
        );

        if (meta.viewOnly) {
          const mimeLower = meta.mimeType.toLowerCase();
          const nameLower = meta.fileName.toLowerCase();
          if (
            mimeLower.startsWith('text/') ||
            mimeLower === 'application/json' ||
            nameLower.endsWith('.txt') ||
            nameLower.endsWith('.md') ||
            nameLower.endsWith('.json')
          ) {
            const decodedText = new TextDecoder().decode(decryptedBuffer);
            setPreviewText(decodedText);
          } else {
            const previewBlob = new Blob([decryptedBuffer], { type: meta.mimeType });
            const objUrl = window.URL.createObjectURL(previewBlob);
            setPreviewUrl(objUrl);
          }
        } else {
          const downloadUrl = window.URL.createObjectURL(new Blob([decryptedBuffer], { type: meta.mimeType }));
          const tempLink = document.createElement('a');
          tempLink.href = downloadUrl;
          tempLink.setAttribute('download', meta.fileName);
          document.body.appendChild(tempLink);
          tempLink.click();
          tempLink.remove();
          window.URL.revokeObjectURL(downloadUrl);
        }

        setDownloadSuccess(true);
        if (meta.burnOnRead) {
          setMeta(prev => prev ? { ...prev, fileName: 'REDACTED' } : null);
        }
      }
    } catch (err: unknown) {
      console.error(err);
      setDownloadError(err instanceof Error ? err.message : 'Decryption cascade failure. Check credentials.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim() || !activeKey || !meta) return;

    setSendingMessage(true);
    try {
      const passVal = password.trim() ? password : null;

      const encryptedSender = await encryptText(senderNickname.trim() || 'Anonymous', activeKey);
      const encryptedText = await encryptText(typedMessage.trim(), activeKey);

      const response = await fetch(`http://localhost:5000/api/vault/chat-send/${uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: passVal,
          senderName: encryptedSender.ciphertextHex,
          messageText: encryptedText.ciphertextHex,
          encryptionIv: encryptedSender.ivHex, 
          authTag: encryptedSender.authTagHex
        })
      });

      if (!response.ok) {
        throw new Error('Message transmission failed.');
      }

      setTypedMessage('');
      await fetchChatLogs();
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to transmit secure message.');
    } finally {
      setSendingMessage(false);
    }
  };

  const copyNoteToClipboard = () => {
    navigator.clipboard.writeText(noteText);
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2000);
  };

  const getReadableSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  if (loading) {
    return (
      <div className="glass-panel max-w-md w-full mx-auto flex flex-col items-center justify-center space-y-4 py-12 text-center">
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
        <div className="text-sm text-slate-500 tracking-wide text-center">Verifying secure link...</div>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="glass-panel max-w-md w-full mx-auto flex flex-col items-center justify-center space-y-6 text-center">
        <div className="w-14 h-14 rounded-full border border-red-200 bg-red-50 flex items-center justify-center mx-auto">
          <ShieldAlert className="text-red-600 w-6 h-6" />
        </div>
        <div className="space-y-2 text-center w-full">
          <h2 className="brand-title" style={{ fontSize: '18px', textAlign: 'center', color: '#ef4444' }}>Link Blocked or Expired</h2>
          <p className="text-xs text-slate-500 text-center">{error || 'This file share link has expired, has been deleted, or fails security checks (IP/Geofencing/Hours).'}</p>
        </div>
        <div className="w-full border-t border-slate-200 pt-4 items-center justify-center">
          <button 
            onClick={onBackToDashboard}
            className="btn-cyber w-full text-xs"
            style={{ backgroundColor: '#64748b', borderColor: '#64748b' }}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (downloadSuccess && meta.shareType === 'note') {
    return (
      <div className="glass-panel max-w-md w-full mx-auto flex flex-col items-center justify-center space-y-6 text-center">
        <div className="flex items-center justify-center space-x-2 border-b border-slate-200 pb-4 w-full text-center">
          <Shield className="text-green-600 w-5 h-5 mx-auto" />
          <span className="brand-title" style={{ fontSize: '15px', textAlign: 'center', color: '#22c55e' }}>Secure Note Decrypted</span>
        </div>

        <div 
          className="w-full text-left bg-slate-900 text-slate-200 p-4 rounded-lg border border-slate-700 relative overflow-hidden" 
          style={{ 
            background: '#0f172a', 
            border: '1px solid #334155',
            userSelect: meta.viewOnly ? 'none' : 'text'
          }}
          onContextMenu={meta.viewOnly ? (e) => e.preventDefault() : undefined}
        >
          <pre style={{ 
            fontFamily: "'SFMono-Regular', Consolas, monospace", 
            fontSize: '13px', 
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-all',
            margin: 0,
            paddingRight: meta.viewOnly ? '0px' : '36px',
            color: '#cbd5e1'
          }}>
            {noteText}
          </pre>
          {!meta.viewOnly && (
            <button 
              onClick={copyNoteToClipboard}
              className="btn-icon"
              style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px', background: '#1e293b' }}
              title="Copy note"
            >
              {noteCopied ? <Copy className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
            </button>
          )}

          {meta.viewOnly && (
            <div style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: '20px',
              padding: '10px',
              zIndex: 10
            }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div 
                  key={i}
                  style={{
                    transform: 'rotate(-20deg)',
                    color: 'rgba(148, 163, 184, 0.08)',
                    fontSize: '9px',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {`CONFIDENTIAL | ${meta.clientIp || 'IP'} | ${new Date().toLocaleDateString()}`}
                </div>
              ))}
            </div>
          )}
        </div>

        {meta.burnOnRead && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded text-xxs text-amber-700 leading-normal text-center max-w-xs w-full">
            <div className="font-bold mb-1 text-center">One-Time Note Shredded:</div>
            This secure note has been read and permanently shredded from the server.
          </div>
        )}

        <div className="w-full border-t border-slate-200 pt-4 items-center justify-center">
          <button 
            onClick={onBackToDashboard}
            className="btn-cyber w-full text-xs"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isChatUnlocked && meta.shareType === 'chat') {
    return (
      <div className="glass-panel max-w-md w-full mx-auto flex flex-col space-y-4" style={{ height: '520px', justifyContent: 'space-between', padding: '16px' }}>
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 w-full" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Shield className="text-indigo-600 w-5 h-5" />
            <span className="brand-title" style={{ fontSize: '14px', fontWeight: '700' }}>Secure Ephemeral Chat</span>
          </div>
          <span className="text-xxs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            {timeRemaining}
          </span>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {chatMessages.length === 0 ? (
            <div className="text-center text-xxs text-slate-400 my-auto">
              Secure thread established. Say hello!
            </div>
          ) : (
            chatMessages.map((msg) => (
              <div 
                key={msg.id}
                style={{
                  alignSelf: msg.decryptedSender === senderNickname ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  background: msg.decryptedSender === senderNickname ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                  color: msg.decryptedSender === senderNickname ? '#ffffff' : 'var(--text-primary)',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--card-shadow)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  textAlign: 'left'
                }}
              >
                <span style={{ 
                  fontSize: '9px', 
                  fontWeight: '700', 
                  color: msg.decryptedSender === senderNickname ? 'rgba(255, 255, 255, 0.8)' : 'var(--color-accent)' 
                }}>
                  {msg.decryptedSender}
                </span>
                <span style={{ fontSize: '12px', wordBreak: 'break-all' }}>
                  {msg.decryptedText}
                </span>
                <span style={{ 
                  fontSize: '8px', 
                  alignSelf: 'flex-end', 
                  opacity: 0.6,
                  color: msg.decryptedSender === senderNickname ? '#ffffff' : 'var(--text-muted)'
                }}>
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={handleSendChatMessage} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <div style={{ display: 'flex', gap: '6px', width: '100%', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', flexShrink: 0 }}>
              <User className="w-3.5 h-3.5 text-slate-400" />
              <input 
                type="text"
                value={senderNickname}
                onChange={(e) => setSenderNickname(e.target.value.slice(0, 15))}
                placeholder="Name"
                className="cyber-input"
                style={{ width: '80px', border: 'none', background: 'transparent', padding: '2px', fontSize: '11px', outline: 'none' }}
                required
              />
            </div>
            <input 
              type="text"
              value={typedMessage}
              onChange={(e) => setTypedMessage(e.target.value)}
              placeholder="Send secure message..."
              className="cyber-input"
              style={{ flex: 1, fontSize: '12px' }}
              disabled={sendingMessage}
              required
            />
            <button 
              type="submit"
              disabled={sendingMessage || !typedMessage.trim()}
              className="btn-icon"
              style={{ padding: '8px', backgroundColor: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#ffffff' }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <button 
            type="button" 
            onClick={onBackToDashboard}
            className="text-center text-xxs text-slate-400 hover:text-slate-600 underline"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Leave Chat & Return
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="glass-panel max-w-md w-full mx-auto flex flex-col items-center justify-center space-y-6 text-center">
      <div className="flex items-center justify-center space-x-2 border-b border-slate-200 pb-4 w-full text-center" style={{ borderColor: 'var(--border-color)' }}>
        <span className="brand-title" style={{ fontSize: '15px', textAlign: 'center' }}>
          {meta.shareType === 'chat' ? 'Secure Chat Handshake' : meta.shareType === 'note' ? 'Secure Note Handshake' : 'Secure File Handshake'}
        </span>
      </div>

      {!downloadSuccess ? (
        meta.recipientEmail && !isOtpVerified ? (
          <div className="flex flex-col space-y-5 w-full items-center justify-center">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg space-y-2 w-full text-center" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
              <div className="text-xxs text-slate-500 tracking-wider font-semibold text-center" style={{ color: 'var(--text-muted)' }}>RECIPIENT VERIFICATION:</div>
              <div className="text-xs text-slate-600 text-center" style={{ color: 'var(--text-secondary)' }}>
                This vault requires identity verification. Access code will be sent to the registered recipient's inbox.
              </div>
            </div>

            {!otpSent ? (
              <form onSubmit={handleOtpRequest} className="flex flex-col space-y-3 w-full items-center">
                <div className="flex flex-col space-y-1.5 w-full items-center justify-center text-center">
                  <label className="text-xs font-semibold text-slate-700 tracking-wider flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                    Recipient Email Address
                  </label>
                  <input 
                    type="email"
                    required
                    placeholder="Enter email to receive code"
                    value={otpEmail}
                    onChange={(e) => setOtpEmail(e.target.value)}
                    className="cyber-input w-full text-center text-sm max-w-xs"
                    disabled={otpLoading}
                  />
                </div>

                {otpError && (
                  <div className="text-xxs text-red-500 font-mono flex items-center justify-center space-x-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{otpError}</span>
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={otpLoading}
                  className="btn-cyber flex items-center justify-center space-x-2 py-2.5 mt-2"
                >
                  {otpLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sending code...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Send Verification Code</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleOtpVerify} className="flex flex-col space-y-3 w-full items-center">
                <div className="flex flex-col space-y-1.5 w-full items-center justify-center text-center">
                  <label className="text-xs font-semibold text-slate-700 tracking-wider flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                    Enter 6-Digit Code
                  </label>
                  <input 
                    type="text"
                    required
                    maxLength={6}
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="cyber-input w-full text-center text-sm max-w-xs tracking-[0.2em] font-mono font-bold"
                    disabled={otpLoading}
                  />
                </div>

                {otpError && (
                  <div className="text-xxs text-red-500 font-mono flex items-center justify-center space-x-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{otpError}</span>
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={otpLoading}
                  className="btn-cyber flex items-center justify-center space-x-2 py-2.5 mt-2"
                >
                  {otpLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify Code</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="text-xxs text-slate-400 hover:text-slate-600 underline mt-2"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Change Email or Resend Code
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleAccessSubmit} className="flex flex-col space-y-5 w-full items-center justify-center">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg space-y-2 w-full text-center" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
              <div className="text-xxs text-slate-500 tracking-wider font-semibold text-center" style={{ color: 'var(--text-muted)' }}>VAULT PARAMETERS:</div>
              <div className="text-sm font-bold text-slate-800 truncate text-center max-w-[280px] mx-auto" style={{ color: 'var(--text-primary)' }}>
                {meta.shareType === 'chat' ? 'Secure Ephemeral Chat Room' : meta.shareType === 'note' ? 'Secure Text Note' : meta.fileName}
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xxs text-slate-500 pt-2 border-t border-slate-200 w-full text-center" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                {meta.shareType !== 'chat' && <div className="text-center">SIZE: {getReadableSize(meta.fileSize)}</div>}
                {meta.shareType !== 'chat' && <div className="text-center">ONE-TIME DELETION: {meta.burnOnRead ? 'YES' : 'NO'}</div>}
                <div className="col-span-2 text-indigo-600 flex items-center justify-center mt-1 font-semibold text-center" style={{ color: 'var(--color-accent)' }}>
                  <Clock className="w-3.5 h-3.5 mr-1 text-indigo-600" style={{ color: 'var(--color-accent)' }} />
                  <span>EXPIRES IN: {timeRemaining}</span>
                </div>
              </div>
            </div>

            {meta.hasPassword ? (
              <div className="flex flex-col space-y-2 w-full items-center justify-center text-center">
                <label className="text-xs font-semibold text-slate-700 tracking-wider flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                  <Key className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
                  VAULT PASSWORD
                </label>
                <input 
                  type="password"
                  required
                  placeholder="Enter access password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="cyber-input w-full text-center text-sm max-w-xs"
                  disabled={downloading}
                />
                {downloadError && (
                  <div className="text-xxs text-red-500 font-mono flex items-center justify-center space-x-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{downloadError}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-2 bg-slate-50 border border-slate-200 rounded p-3 text-xxs text-slate-500 max-w-xs w-full" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                No password required. Click below to verify and enter.
              </div>
            )}

            {meta.burnOnRead && meta.shareType !== 'chat' && (
              <div className="bg-red-50 border border-red-200 p-3 rounded flex flex-col items-center justify-center text-center max-w-xs w-full" style={{ backgroundColor: 'rgba(239, 68, 68, 0.04)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                <AlertTriangle className="w-5 h-5 text-red-500 mb-1.5" />
                <div className="text-xxs text-red-600 leading-normal text-center font-medium">
                  One-time read active: this item will be permanently shredded from the server immediately after download.
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={downloading}
              className="btn-cyber flex items-center justify-center space-x-2 py-3"
            >
              {downloading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Unlocking secure key...</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4" />
                  <span>{meta.shareType === 'chat' ? 'Enter Chat Room' : meta.shareType === 'note' ? 'View Secure Note' : 'Decrypt & Download'}</span>
                </>
              )}
            </button>
          </form>
        )
      ) : meta.viewOnly ? (
        <div className="flex flex-col space-y-4 py-2 text-center items-center justify-center w-full max-w-lg mx-auto">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 w-full" style={{ borderColor: 'var(--border-color)' }}>
            <Shield className="text-indigo-600 w-5 h-5" />
            <span className="brand-title text-left" style={{ fontSize: '14px', fontWeight: '700' }}>Secure View-Only Session</span>
          </div>

          <div className="text-left w-full text-xxs text-slate-400 bg-amber-500/10 border border-amber-500/20 rounded p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Access Policy:</strong> Downloading, copying, right-clicking, and printing have been disabled by the owner. All access events are audited.
            </div>
          </div>

          <div 
            className="w-full relative overflow-hidden bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col justify-center items-center select-none"
            style={{ minHeight: '300px', userSelect: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {previewText !== null ? (
              <pre style={{
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
                color: '#cbd5e1',
                width: '100%',
                textAlign: 'left'
              }}>
                {previewText}
              </pre>
            ) : previewUrl ? (
              meta.mimeType.startsWith('image/') ? (
                <img 
                  src={previewUrl} 
                  alt="Secure Document Preview" 
                  className="max-w-full max-h-[400px] object-contain rounded pointer-events-none" 
                />
              ) : meta.mimeType === 'application/pdf' ? (
                <iframe 
                  src={`${previewUrl}#toolbar=0`} 
                  className="w-full h-[400px] border-none rounded" 
                  title="PDF Viewer" 
                />
              ) : (
                <div className="text-center p-6 space-y-2">
                  <ShieldAlert className="w-10 h-10 text-slate-500 mx-auto" />
                  <div className="text-xs font-semibold text-slate-300">Format Preview Unsupported</div>
                  <div className="text-xxs text-slate-400">In-browser preview is not supported for mime-type: {meta.mimeType}. Access is blocked to enforce security controls.</div>
                </div>
              )
            ) : (
              <div className="text-center py-8 text-xxs text-slate-400">Decrypting view payload...</div>
            )}

            {/* Premium Rotated Watermark Overlay */}
            <div style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(3, 1fr)',
              gap: '40px',
              padding: '20px',
              zIndex: 30
            }}>
              {Array.from({ length: 9 }).map((_, i) => (
                <div 
                  key={i}
                  style={{
                    transform: 'rotate(-25deg)',
                    color: 'rgba(148, 163, 184, 0.08)',
                    fontSize: '9px',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {`SECULINK | ${meta.clientIp || 'IP'} | ${new Date().toLocaleDateString()}`}
                </div>
              ))}
            </div>
          </div>

          {meta.burnOnRead && (
            <div className="bg-amber-50 border border-amber-200 p-3 rounded text-xxs text-amber-700 leading-normal text-center w-full">
              <div className="font-bold mb-0.5 text-center">One-Time File Shredded:</div>
              The encrypted file has been permanently purged from storage. Closing this window terminates access.
            </div>
          )}

          <div className="w-full border-t border-slate-200 pt-3 items-center justify-center" style={{ borderColor: 'var(--border-color)' }}>
            <button 
              onClick={onBackToDashboard}
              className="btn-cyber w-full text-xs font-semibold"
            >
              Close Viewer & Return
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col space-y-6 py-4 text-center items-center justify-center w-full">
          <div className="w-14 h-14 mx-auto rounded-full border border-green-200 bg-green-50 flex items-center justify-center">
            <FileCheck className="text-green-600 w-6 h-6" />
          </div>
          
          <div className="space-y-1 text-center w-full">
            <h3 className="brand-title" style={{ fontSize: '16px', textAlign: 'center', color: '#22c55e' }}>Download Successful</h3>
            <p className="text-xs text-slate-500 text-center">Your file has been successfully decrypted and saved.</p>
          </div>

          {meta.burnOnRead && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded text-xxs text-amber-700 leading-normal text-center max-w-xs w-full">
              <div className="font-bold mb-1 text-center">One-Time File Shredded:</div>
              This file has been permanently deleted from storage. Subsequent downloads will fail.
            </div>
          )}

          <div className="w-full border-t border-slate-200 pt-4 items-center justify-center" style={{ borderColor: 'var(--border-color)' }}>
            <button 
              onClick={onBackToDashboard}
              className="btn-cyber w-full text-xs"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
