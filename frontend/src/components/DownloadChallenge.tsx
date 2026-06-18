import React, { useState, useEffect, useRef } from 'react';
import { Shield, ShieldAlert, Key, Download, RefreshCw, AlertTriangle, FileCheck, Clock, Copy, Send, User } from 'lucide-react';
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

  useEffect(() => {
    const hashParts = window.location.hash.split('#');
    if (hashParts[2] && hashParts[2].length === 64) {
      setRawKeyHex(hashParts[2]);
    }
  }, []);

  useEffect(() => {
    fetchChallengeInfo();
  }, [uuid]);

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
  }, [isChatUnlocked, activeKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const fetchChallengeInfo = async () => {
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unable to establish host handshake.');
    } finally {
      setLoading(false);
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

        const downloadUrl = window.URL.createObjectURL(new Blob([decryptedBuffer], { type: meta.mimeType }));
        const tempLink = document.createElement('a');
        tempLink.href = downloadUrl;
        tempLink.setAttribute('download', meta.fileName);
        document.body.appendChild(tempLink);
        tempLink.click();
        tempLink.remove();
        window.URL.revokeObjectURL(downloadUrl);

        setDownloadSuccess(true);
        if (meta.burnOnRead) {
          setMeta(prev => prev ? { ...prev, fileName: 'REDACTED' } : null);
        }
      }
    } catch (err: any) {
      console.error(err);
      setDownloadError(err.message || 'Decryption cascade failure. Check credentials.');
    } finally {
      setDownloading(false);
    }
  };

  const fetchChatLogs = async () => {
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
          } catch (e) {
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
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to transmit secure message.');
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

        <div className="w-full text-left bg-slate-900 text-slate-200 p-4 rounded-lg border border-slate-700 relative" style={{ background: '#0f172a', border: '1px solid #334155' }}>
          <pre style={{ 
            fontFamily: "'SFMono-Regular', Consolas, monospace", 
            fontSize: '13px', 
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-all',
            margin: 0,
            paddingRight: '36px',
            color: '#cbd5e1'
          }}>
            {noteText}
          </pre>
          <button 
            onClick={copyNoteToClipboard}
            className="btn-icon"
            style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px', background: '#1e293b' }}
            title="Copy note"
          >
            {noteCopied ? <Copy className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
          </button>
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
        <Shield className="text-indigo-600 w-5 h-5 mx-auto" />
        <span className="brand-title" style={{ fontSize: '15px', textAlign: 'center' }}>
          {meta.shareType === 'chat' ? 'Secure Chat Handshake' : meta.shareType === 'note' ? 'Secure Note Handshake' : 'Secure File Handshake'}
        </span>
      </div>

      {!downloadSuccess ? (
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
