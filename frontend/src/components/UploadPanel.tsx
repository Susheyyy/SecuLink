import React, { useState, useRef } from 'react';
import { Upload, Shield, Link as LinkIcon, Check, Copy, MessageSquare, FileText, Globe, Clock } from 'lucide-react';
import type { ConsoleLogEntry } from './ConsolePanel';
import { encryptInWorker } from '../utils/cryptoWorker';

interface UploadPanelProps {
  addLog: (type: ConsoleLogEntry['type'], message: string) => void;
  onUploadSuccess: (newLink: { uuid: string; fileName: string; expiresAt: string; burnOnRead: boolean }) => void;
}

function scanForSensitiveData(text: string): string[] {
  const warnings: string[] = [];
  
  const ccRegex = /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13})\b/;
  if (ccRegex.test(text)) {
    warnings.push('Credit Card Number');
  }

  const aadhaarRegex = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/;
  if (aadhaarRegex.test(text)) {
    warnings.push('Aadhaar Number');
  }

  const apiKeyRegex = /(sk_live_[0-9a-zA-Z]{24})|(AIzaSy[0-9a-zA-Z_-]{35})|(ghp_[0-9a-zA-Z]{36})|(\b[a-zA-Z0-9_-]{32,64}\b.*(key|secret|password|passwd|token))/i;
  if (apiKeyRegex.test(text)) {
    warnings.push('Private API Key / Password');
  }

  return warnings;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({ addLog, onUploadSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [expireValue, setExpireValue] = useState(60);
  const [expireUnit, setExpireUnit] = useState('minutes');
  const [burnOnRead, setBurnOnRead] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [resultLink, setResultLink] = useState('');
  const [copied, setCopied] = useState(false);

  const [allowedIp, setAllowedIp] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isDirect, setIsDirect] = useState(false);

  const [shareType, setShareType] = useState('file');
  const [noteText, setNoteText] = useState('');
  
  const [allowedCountries, setAllowedCountries] = useState('');
  const [geoIN, setGeoIN] = useState(false);
  const [geoSG, setGeoSG] = useState(false);
  const [geoUS, setGeoUS] = useState(false);

  const [accessWindowStart, setAccessWindowStart] = useState('');
  const [accessWindowEnd, setAccessWindowEnd] = useState('');

  const [viewOnly, setViewOnly] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [hasGeofencing, setHasGeofencing] = useState(false);
  const [hasActiveHours, setHasActiveHours] = useState(false);
  const [hasAllowedIp, setHasAllowedIp] = useState(false);
  const [hasRecipientEmail, setHasRecipientEmail] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      addLog('info', `File loaded: ${e.dataTransfer.files[0].name} (${(e.dataTransfer.files[0].size / 1024 / 1024).toFixed(2)} MB)`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      addLog('info', `File loaded: ${e.target.files[0].name} (${(e.target.files[0].size / 1024 / 1024).toFixed(2)} MB)`);
    }
  };

  const getCompiledCountries = () => {
    if (!hasGeofencing) return '';
    const list: string[] = [];
    if (geoIN) list.push('IN');
    if (geoSG) list.push('SG');
    if (geoUS) list.push('US');
    if (allowedCountries.trim()) {
      allowedCountries.split(',').forEach(c => {
        const clean = c.trim().toUpperCase();
        if (clean && !list.includes(clean)) list.push(clean);
      });
    }
    return list.join(',');
  };

  const triggerUpload = async () => {
    let fileBuffer: ArrayBuffer;
    let fileName: string;
    let mimeType: string;
    let fileSize: number;

    if (shareType === 'note') {
      if (!noteText.trim()) {
        alert('Please enter a note to share.');
        return;
      }
      
      const warnings = scanForSensitiveData(noteText);
      if (warnings.length > 0) {
        const proceed = window.confirm(
          `CAUTION: Potential sensitive data detected inside your note:\n- ${warnings.join('\n- ')}\n\nSharing secrets, credit cards, or personal identifiers is highly risky. Proceed anyway?`
        );
        if (!proceed) return;
      }

      const noteBytes = new TextEncoder().encode(noteText);
      fileBuffer = noteBytes.buffer;
      fileName = 'note.txt';
      mimeType = 'text/plain';
      fileSize = noteBytes.length;
    } else if (shareType === 'chat') {
      const dummyBytes = new Uint8Array(0);
      fileBuffer = dummyBytes.buffer;
      fileName = 'chat_room.json';
      mimeType = 'application/json';
      fileSize = 0;
    } else {
      if (!file) {
        alert('Please select a file first.');
        return;
      }

  
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
        const text = await file.text();
        const warnings = scanForSensitiveData(text);
        if (warnings.length > 0) {
          const proceed = window.confirm(
            `CAUTION: Potential sensitive data detected inside file ${file.name}:\n- ${warnings.join('\n- ')}\n\nSharing credentials, passwords, or personal keys is high-risk. Proceed anyway?`
          );
          if (!proceed) return;
        }
      }

      fileBuffer = await file.arrayBuffer();
      fileName = file.name;
      mimeType = file.type || 'application/octet-stream';
      fileSize = file.size;
    }

    setUploading(true);
    setUploadProgress(10);

    try {
      setStatusText('Offloading encryption to background Web Worker...');
      addLog('info', `[CRYPTO] Web Worker spawned. Deriving keys and generating AES ciphertext...`);
      
      const salt = Array.from(window.crypto.getRandomValues(new Uint8Array(16)));
      const iv = Array.from(window.crypto.getRandomValues(new Uint8Array(12)));
      
      const encResult = await encryptInWorker(
        fileBuffer,
        (hasPassword && password) ? password : undefined,
        salt,
        iv
      );

      setUploadProgress(40);

      const saltHex = salt.map(b => b.toString(16).padStart(2, '0')).join('');
      const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
      const authTagHex = encResult.authTag.map(b => b.toString(16).padStart(2, '0')).join('');
      const finalCountries = hasGeofencing ? getCompiledCountries() : '';
      const finalAllowedIp = hasAllowedIp ? allowedIp.trim() : '';
      const finalNotificationEmail = hasRecipientEmail ? notificationEmail.trim() : '';
      const finalWindowStart = hasActiveHours ? accessWindowStart : null;
      const finalWindowEnd = hasActiveHours ? accessWindowEnd : null;

      if (isDirect) {
        setStatusText('Requesting presigned upload URL...');
        addLog('info', `[NETWORK] Requester metadata validation...`);

        const randomHash = window.crypto.randomUUID ? window.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });

        const payload = {
          fileName,
          mimeType,
          fileSize,
          expireValue,
          expireUnit,
          burnOnRead,
          password: (hasPassword && password) ? password : '',
          allowedIp: finalAllowedIp || null,
          notificationEmail: finalNotificationEmail || null,
          encryptionKey: encResult.keyHex || '',
          encryptionIv: ivHex,
          authTag: authTagHex,
          fileHash: randomHash,
          allowedCountries: finalCountries || null,
          accessWindowStart: finalWindowStart || null,
          accessWindowEnd: finalWindowEnd || null,
          shareType,
          cryptoSalt: saltHex,
          recipientEmail: finalNotificationEmail || null,
          viewOnly: viewOnly
        };

        const response = await fetch('http://localhost:5000/api/vault/signed-upload-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Server failed to generate presigned upload details.');
        }

        const uploadDetails = await response.json();
        
        setUploadProgress(70);
        setStatusText('Streaming encrypted payload directly to cloud storage...');
        addLog('info', `[NETWORK] Streaming payload directly to storage...`);

        const uploadResponse = await fetch(uploadDetails.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          body: encResult.ciphertext
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload encrypted payload directly to storage.');
        }

        setUploadProgress(100);
        setStatusText('Direct upload successful. Secure link generated.');
        addLog('success', `[VAULT] Zero-Knowledge Direct upload complete! UUID: ${uploadDetails.uuid}`);
        addLog('success', `[EXPIRY] Link expiration scheduled for: ${new Date(uploadDetails.expiresAt).toLocaleTimeString()}`);

        let secureUrl = `${window.location.origin}${window.location.pathname}#/vault/${uploadDetails.uuid}`;
        if (!hasPassword && encResult.keyHex) {
          secureUrl += `#${encResult.keyHex}`;
        }
        setResultLink(secureUrl);
        
        onUploadSuccess({
          uuid: uploadDetails.uuid,
          fileName,
          expiresAt: uploadDetails.expiresAt,
          burnOnRead: burnOnRead
        });

      } else {
        setStatusText('Uploading encrypted payload...');
        addLog('info', `[NETWORK] Transmitting encrypted block to server...`);

        const encryptedBlob = new Blob([encResult.ciphertext], { type: 'application/octet-stream' });
        const formData = new FormData();
        formData.append('file', encryptedBlob, fileName);
        formData.append('isDirectZeroKnowledge', 'true');
        formData.append('encryptionKey', encResult.keyHex || '');
        formData.append('encryptionIv', ivHex);
        formData.append('authTag', authTagHex);
        formData.append('expireValue', expireValue.toString());
        formData.append('expireUnit', expireUnit);
        formData.append('burnOnRead', burnOnRead.toString());
        formData.append('shareType', shareType);
        formData.append('cryptoSalt', saltHex);
        formData.append('viewOnly', viewOnly.toString());
        if (finalAllowedIp) formData.append('allowedIp', finalAllowedIp);
        if (finalNotificationEmail) {
          formData.append('notificationEmail', finalNotificationEmail);
          formData.append('recipientEmail', finalNotificationEmail); 
        }
        if (finalCountries) formData.append('allowedCountries', finalCountries);
        if (finalWindowStart) formData.append('accessWindowStart', finalWindowStart);
        if (finalWindowEnd) formData.append('accessWindowEnd', finalWindowEnd);
        if (hasPassword && password) {
          formData.append('password', password);
        }

        const response = await fetch('http://localhost:5000/api/vault/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Server rejected file upload.');
        }

        const result = await response.json();
        setUploadProgress(100);
        setStatusText('Secure link generated.');
        addLog('success', `[EXPIRY] Link expiration scheduled for: ${new Date(result.expiresAt).toLocaleTimeString()}`);
        
        let secureUrl = `${window.location.origin}${window.location.pathname}#/vault/${result.uuid}`;
        if (!hasPassword && encResult.keyHex) {
          secureUrl += `#${encResult.keyHex}`;
        }
        setResultLink(secureUrl);
        
        onUploadSuccess({
          uuid: result.uuid,
          fileName,
          expiresAt: result.expiresAt,
          burnOnRead: result.burnOnRead
        });

        addLog('success', `[VAULT] File encrypted and saved. UUID: ${result.uuid}`);
      }
    } catch (error: unknown) {
      console.error(error);
      setStatusText('Upload failed.');
      const err = error as Error;
      addLog('error', `[UPLOAD ERROR] ${err.message || 'Connection failure.'}`);
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(resultLink);
    setCopied(true);
    addLog('success', `Copied link to clipboard.`);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetUploader = () => {
    setFile(null);
    setPassword('');
    setHasPassword(false);
    setAllowedIp('');
    setNotificationEmail('');
    setIsDirect(false);
    setResultLink('');
    setUploadProgress(0);
    setStatusText('');
    setShareType('file');
    setNoteText('');
    setAllowedCountries('');
    setGeoIN(false);
    setGeoSG(false);
    setGeoUS(false);
    setAccessWindowStart('');
    setAccessWindowEnd('');
    setViewOnly(false);
    setShowOptions(false);
    setHasGeofencing(false);
    setHasActiveHours(false);
    setHasAllowedIp(false);
    setHasRecipientEmail(false);
  };

  return (
    <div className="glass-panel">
      {!resultLink ? (
        <div className="app-container" style={{ gap: '20px' }}>

          <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 14px' }}>
            <div className="form-group-title" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Share Type</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShareType('file')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: shareType === 'file' ? '1.5px solid var(--color-accent)' : '1px solid var(--border-color)',
                  background: shareType === 'file' ? 'var(--color-accent-soft)' : 'var(--bg-secondary)',
                  color: shareType === 'file' ? 'var(--color-accent)' : 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Upload className="w-4 h-4" />
                <span>Secure File</span>
              </button>
              <button
                type="button"
                onClick={() => setShareType('note')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: shareType === 'note' ? '1.5px solid var(--color-accent)' : '1px solid var(--border-color)',
                  background: shareType === 'note' ? 'var(--color-accent-soft)' : 'var(--bg-secondary)',
                  color: shareType === 'note' ? 'var(--color-accent)' : 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <FileText className="w-4 h-4" />
                <span>Secure Note</span>
              </button>
              <button
                type="button"
                onClick={() => setShareType('chat')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: shareType === 'chat' ? '1.5px solid var(--color-accent)' : '1px solid var(--border-color)',
                  background: shareType === 'chat' ? 'var(--color-accent-soft)' : 'var(--bg-secondary)',
                  color: shareType === 'chat' ? 'var(--color-accent)' : 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Secure Chat</span>
              </button>
            </div>
          </div>

          {shareType === 'file' ? (
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
              style={{ minHeight: '180px' }}
            >
              <input 
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="input-hidden"
              />
              {uploading ? (
                <div className="app-container" style={{ gap: '16px', alignItems: 'center' }}>
                  <svg className="w-12 h-12 animate-spin text-indigo-600" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="6" fill="none" strokeDasharray="50 150" opacity="0.2" />
                    <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="6" fill="none" strokeDasharray="100 100" />
                  </svg>
                  <div>
                    <div className="text-sm font-semibold text-slate-700">{statusText}</div>
                    <div className="cyber-input" style={{ width: '200px', height: '8px', marginTop: '10px', padding: '0', overflow: 'hidden', backgroundColor: '#e2e8f0', border: 'none' }}>
                      <div style={{ backgroundColor: 'var(--color-accent)', height: '100%', width: `${uploadProgress}%`, transition: 'all 0.3s' }}></div>
                    </div>
                  </div>
                </div>
              ) : file ? (
                <div className="app-container" style={{ gap: '8px', alignItems: 'center' }}>
                  <Shield className="w-10 h-10 text-indigo-600" style={{ color: 'var(--color-accent)' }} />
                  <div className="text-sm font-bold text-slate-800 max-w-[250px] truncate" style={{ color: 'var(--text-primary)' }}>{file.name}</div>
                  <div className="text-xs text-slate-500" style={{ color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-xs cursor-pointer text-red-500 hover:text-red-700"
                    style={{ background: 'transparent', border: 'none', textDecoration: 'underline' }}
                  >
                    Remove File
                  </button>
                </div>
              ) : (
                <div className="app-container" style={{ gap: '12px', alignItems: 'center' }}>
                  <Upload className="w-12 h-12 text-slate-400" style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <p className="text-sm font-semibold text-slate-700" style={{ color: 'var(--text-primary)' }}>Drag & drop document here, or click to browse</p>
                    <p className="text-xs text-slate-400 mt-1" style={{ color: 'var(--text-muted)' }}>PDF, ZIP, PNG, JPG, TXT (Max 50MB)</p>
                  </div>
                </div>
              )}
            </div>
          ) : shareType === 'note' ? (
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', textAlign: 'left' }}>
                <span>Secure Text Note Content</span>
              </div>
              <textarea 
                placeholder="Type your sensitive note, API keys, or credentials here..." 
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="cyber-input"
                style={{ 
                  height: '160px', 
                  fontFamily: "'SFMono-Regular', Consolas, monospace", 
                  fontSize: '13px', 
                  background: 'var(--bg-secondary)', 
                  border: '1px solid var(--border-color)', 
                  color: 'var(--text-primary)',
                  resize: 'vertical'
                }}
                disabled={uploading}
              />
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 p-6 rounded-lg text-center flex flex-col items-center gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
              <MessageSquare className="w-10 h-10 text-indigo-600" style={{ color: 'var(--color-accent)' }} />
              <h3 className="text-sm font-bold text-slate-800" style={{ color: 'var(--text-primary)' }}>Create Ephemeral Chat Room</h3>
              <p className="text-xs text-slate-500 max-w-[280px]" style={{ color: 'var(--text-muted)' }}>
                This will generate a zero-knowledge encrypted chat link. All messages are encrypted locally before transmission and shredded on expiration.
              </p>
            </div>
          )}

          <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', marginTop: '16px' }}>
            <div className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'left' }}>
              <span>Link Expiration Duration (Required)</span>
            </div>
            <div className="form-group-row" style={{ gap: '10px', display: 'flex', width: '100%' }}>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input 
                  type="number" 
                  min="1"
                  max="1440"
                  value={expireValue}
                  onChange={(e) => setExpireValue(Math.max(1, parseInt(e.target.value) || 1))}
                  className="cyber-input"
                  style={{ 
                    width: '90px', 
                    paddingRight: '28px', 
                    textAlign: 'left', 
                    background: 'var(--bg-secondary)', 
                    border: '1px solid var(--border-color)', 
                    color: 'var(--text-primary)' 
                  }}
                  disabled={uploading}
                />
                <div style={{ 
                  position: 'absolute', 
                  right: '8px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  height: '24px', 
                  justifyContent: 'center', 
                  gap: '2px' 
                }}>
                  <button 
                    type="button" 
                    onClick={() => setExpireValue(prev => Math.min(1440, prev + 1))}
                    disabled={uploading}
                    className="spin-btn"
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      padding: 0, 
                      color: 'var(--text-secondary)', 
                      fontSize: '9px', 
                      lineHeight: '1', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ▲
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setExpireValue(prev => Math.max(1, prev - 1))}
                    disabled={uploading}
                    className="spin-btn"
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      padding: 0, 
                      color: 'var(--text-secondary)', 
                      fontSize: '9px', 
                      lineHeight: '1', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ▼
                  </button>
                </div>
              </div>
              <select 
                value={expireUnit}
                onChange={(e) => setExpireUnit(e.target.value)}
                className="cyber-select"
                style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                disabled={uploading}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
            </div>
          </div>

          <div style={{ width: '100%', marginTop: '16px' }}>
            <button
              type="button"
              onClick={() => setShowOptions(!showOptions)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '14px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield className="w-4 h-4 text-indigo-600" style={{ color: 'var(--color-accent)' }} />
                <span>Configure Advanced Security Options (Optional)</span>
              </span>
              <span style={{ transform: showOptions ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: '10px' }}>▼</span>
            </button>

            {showOptions && (
              <div className="app-container" style={{ marginTop: '14px', gap: '14px' }}>
                <div className="form-grid">
                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', opacity: hasPassword ? 1 : 0.8 }}>
                    <div className="form-group-row" style={{ marginBottom: '8px', justifyContent: 'space-between' }}>
                      <span className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Password Protection</span>
                      <input 
                        type="checkbox"
                        checked={hasPassword}
                        onChange={(e) => {
                          setHasPassword(e.target.checked);
                          if (!e.target.checked) setPassword('');
                        }}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                    <input 
                      type="password"
                      placeholder={hasPassword ? "Enter Access Password" : "Not Enabled"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="cyber-input"
                      style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      disabled={!hasPassword || uploading}
                    />
                  </div>

                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', justifyContent: 'center' }}>
                    <div className="form-group-row" style={{ gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ textAlign: 'left', flex: 1 }}>
                        <span className="form-group-title" style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>One-Time Download</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>Link automatically deletes after download.</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={burnOnRead}
                        onChange={(e) => setBurnOnRead(e.target.checked)}
                        className="cursor-pointer"
                        disabled={uploading || shareType === 'chat' || viewOnly} 
                      />
                    </div>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', justifyContent: 'center' }}>
                    <div className="form-group-row" style={{ gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ textAlign: 'left', flex: 1 }}>
                        <span className="form-group-title" style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Secure Viewing (View Only)</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>Disable right-click / download, watermark viewer identity.</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={viewOnly}
                        onChange={(e) => {
                          setViewOnly(e.target.checked);
                          if (e.target.checked) setBurnOnRead(false);
                        }}
                        className="cursor-pointer"
                        disabled={uploading || shareType === 'chat'}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', justifyContent: 'center' }}>
                    <div className="form-group-row" style={{ gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ textAlign: 'left', flex: 1 }}>
                        <span className="form-group-title" style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Direct Cloud Upload (Signed PUT)</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>Encrypt locally, upload direct (bypasses server).</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={isDirect}
                        onChange={(e) => setIsDirect(e.target.checked)}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', opacity: hasGeofencing ? 1 : 0.8 }}>
                    <div className="form-group-row" style={{ marginBottom: '8px', justifyContent: 'space-between' }}>
                      <span className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Globe className="w-3.5 h-3.5 text-slate-400" />
                        <span>Geofencing Restrictions</span>
                      </span>
                      <input 
                        type="checkbox"
                        checked={hasGeofencing}
                        onChange={(e) => {
                          setHasGeofencing(e.target.checked);
                          if (!e.target.checked) {
                            setGeoIN(false);
                            setGeoSG(false);
                            setGeoUS(false);
                            setAllowedCountries('');
                          }
                        }}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                    {hasGeofencing ? (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <input type="checkbox" checked={geoIN} onChange={(e) => setGeoIN(e.target.checked)} disabled={uploading} style={{ width: '14px', height: '14px' }} />
                            <span>India (IN)</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <input type="checkbox" checked={geoSG} onChange={(e) => setGeoSG(e.target.checked)} disabled={uploading} style={{ width: '14px', height: '14px' }} />
                            <span>Singapore (SG)</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <input type="checkbox" checked={geoUS} onChange={(e) => setGeoUS(e.target.checked)} disabled={uploading} style={{ width: '14px', height: '14px' }} />
                            <span>USA (US)</span>
                          </label>
                        </div>
                        <input 
                          type="text"
                          placeholder="Custom country codes (e.g. CA, DE, GB)"
                          value={allowedCountries}
                          onChange={(e) => setAllowedCountries(e.target.value)}
                          className="cyber-input"
                          style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                          disabled={uploading}
                        />
                      </>
                    ) : (
                      <div className="text-xxs text-slate-400 py-1">Not Enabled</div>
                    )}
                  </div>

                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', opacity: hasActiveHours ? 1 : 0.8 }}>
                    <div className="form-group-row" style={{ marginBottom: '8px', justifyContent: 'space-between' }}>
                      <span className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Active Download Hours</span>
                      </span>
                      <input 
                        type="checkbox"
                        checked={hasActiveHours}
                        onChange={(e) => {
                          setHasActiveHours(e.target.checked);
                          if (!e.target.checked) {
                            setAccessWindowStart('');
                            setAccessWindowEnd('');
                          }
                        }}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                    {hasActiveHours ? (
                      <div className="form-group-row" style={{ gap: '8px', alignItems: 'center' }}>
                        <input 
                          type="time"
                          value={accessWindowStart}
                          onChange={(e) => setAccessWindowStart(e.target.value)}
                          className="cyber-input"
                          style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px' }}
                          disabled={uploading}
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>to</span>
                        <input 
                          type="time"
                          value={accessWindowEnd}
                          onChange={(e) => setAccessWindowEnd(e.target.value)}
                          className="cyber-input"
                          style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px' }}
                          disabled={uploading}
                        />
                      </div>
                    ) : (
                      <div className="text-xxs text-slate-400 py-1">Not Enabled</div>
                    )}
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', opacity: hasAllowedIp ? 1 : 0.8 }}>
                    <div className="form-group-row" style={{ marginBottom: '8px', justifyContent: 'space-between' }}>
                      <span className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Allowed Receiver IP</span>
                      <input 
                        type="checkbox"
                        checked={hasAllowedIp}
                        onChange={(e) => {
                          setHasAllowedIp(e.target.checked);
                          if (!e.target.checked) setAllowedIp('');
                        }}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                    <input 
                      type="text"
                      placeholder={hasAllowedIp ? "e.g. 192.168.1.100" : "Not Enabled"}
                      value={allowedIp}
                      onChange={(e) => setAllowedIp(e.target.value)}
                      className="cyber-input"
                      style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      disabled={!hasAllowedIp || uploading}
                    />
                  </div>

                  <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px', opacity: hasRecipientEmail ? 1 : 0.8 }}>
                    <div className="form-group-row" style={{ marginBottom: '8px', justifyContent: 'space-between' }}>
                      <span className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Recipient Email Verification</span>
                      <input 
                        type="checkbox"
                        checked={hasRecipientEmail}
                        onChange={(e) => {
                          setHasRecipientEmail(e.target.checked);
                          if (!e.target.checked) setNotificationEmail('');
                        }}
                        className="cursor-pointer"
                        disabled={uploading}
                      />
                    </div>
                    <input 
                      type="email"
                      placeholder={hasRecipientEmail ? "e.g. verifier@domain.com" : "Not Enabled"}
                      value={notificationEmail}
                      onChange={(e) => setNotificationEmail(e.target.value)}
                      className="cyber-input"
                      style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      disabled={!hasRecipientEmail || uploading}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button 
            disabled={(shareType === 'file' && !file) || (shareType === 'note' && !noteText.trim()) || uploading}
            onClick={triggerUpload}
            className="btn-cyber"
            style={{
              alignSelf: 'center',
              width: 'auto',
              minWidth: '180px',
              padding: '12px 32px',
              borderRadius: '24px',
              fontSize: '15px',
              marginTop: '8px'
            }}
          >
            {shareType === 'chat' ? 'Create Chat Room' : 'Generate Link'}
          </button>
        </div>
      ) : (
        <div className="app-container" style={{ alignItems: 'center' }}>
          <div className="app-container" style={{ gap: '8px', alignItems: 'center' }}>
            <div className="header-badge" style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}>
              <Shield className="w-4 h-4" />
              <span>Secure Link Generated</span>
            </div>
            <p className="text-xs text-slate-500 max-w-[300px]" style={{ textAlign: 'center' }}>
              {shareType === 'chat' 
                ? 'Your ephemeral chat room is ready. Share this secure link with participants.' 
                : 'The contents are encrypted locally. Share this secure link with the recipient.'}
            </p>
          </div>

          <div className="form-group-row" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', width: '100%', marginTop: '16px' }}>
            <LinkIcon className="w-4 h-4 text-slate-400" style={{ flexShrink: 0 }} />
            <span className="text-xs truncate text-slate-700" style={{ flex: 1, padding: '0 8px', textAlign: 'left', color: 'var(--text-primary)' }}>{resultLink}</span>
            <button 
              onClick={copyToClipboard}
              className="btn-icon"
              title="Copy link"
              style={{ padding: '6px' }}
            >
              {copied ? <Check className="w-4 h-4 text-indigo-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(resultLink)}`} 
              alt="Secure Access QR Code" 
              style={{ 
                border: '4px solid #ffffff', 
                borderRadius: '8px', 
                boxShadow: 'var(--card-shadow)',
                background: '#ffffff',
                width: '150px',
                height: '150px'
              }} 
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Scan QR code for secure mobile entry</span>
          </div>

          <button 
            onClick={resetUploader}
            className="btn-cyber"
            style={{ marginTop: '24px', width: 'auto', minWidth: '180px' }}
          >
            Create Another Share
          </button>
        </div>
      )}
    </div>
  );
};
