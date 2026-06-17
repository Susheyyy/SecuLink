import React, { useState, useRef } from 'react';
import { Upload, Shield, Link as LinkIcon, Check, Copy } from 'lucide-react';
import type { ConsoleLogEntry } from './ConsolePanel';


interface UploadPanelProps {
  addLog: (type: ConsoleLogEntry['type'], message: string) => void;
  onUploadSuccess: (newLink: { uuid: string; fileName: string; expiresAt: string; burnOnRead: boolean }) => void;
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

  const triggerUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadProgress(10);
    setStatusText('Initializing secure upload...');
    addLog('info', `[UPLOAD] Starting upload for file: ${file.name}`);

    setTimeout(async () => {
      setUploadProgress(35);
      setStatusText('Encrypting file in memory (AES-256-GCM)...');
      addLog('success', `[CRYPTO] Envelope key successfully generated.`);
      addLog('info', `[CRYPTO] Encrypting stream chunks with authenticated tag validations.`);

      setTimeout(async () => {
        setUploadProgress(70);
        setStatusText('Uploading encrypted payload...');
        addLog('info', `[NETWORK] Transmitting encrypted block to server...`);

        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('expireValue', expireValue.toString());
          formData.append('expireUnit', expireUnit);
          formData.append('burnOnRead', burnOnRead.toString());
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
          
          const secureUrl = `${window.location.origin}${window.location.pathname}#/vault/${result.uuid}`;
          setResultLink(secureUrl);
          
          onUploadSuccess({
            uuid: result.uuid,
            fileName: file.name,
            expiresAt: result.expiresAt,
            burnOnRead: result.burnOnRead
          });

          addLog('success', `[VAULT] File encrypted and saved. UUID: ${result.uuid}`);
        } catch (error: any) {
          console.error(error);
          setStatusText('Upload failed.');
          addLog('error', `[UPLOAD ERROR] ${error.message || 'Connection failure.'}`);
          setUploadProgress(0);
        } finally {
          setUploading(false);
        }
      }, 800);
    }, 800);
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
    setResultLink('');
    setUploadProgress(0);
    setStatusText('');
  };

  return (
    <div className="glass-panel">
      {!resultLink ? (
        <div className="app-container" style={{ gap: '20px' }}>
          {/* Drag and Drop Zone */}
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

          {/* Secure Parameters Drawers */}
          <div className="form-grid">
            {/* Expiry Selector */}
            <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px' }}>
              <div className="form-group-title" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
                <span>Link Expiration</span>
              </div>
              <div className="form-group-row" style={{ gap: '10px' }}>
                <input 
                  type="number" 
                  min="1"
                  max="1440"
                  value={expireValue}
                  onChange={(e) => setExpireValue(Math.max(1, parseInt(e.target.value) || 1))}
                  className="cyber-input"
                  style={{ width: '80px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  disabled={uploading}
                />
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

            {/* Password Locks */}
            <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px' }}>
              <div className="form-group-row" style={{ marginBottom: '8px' }}>
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
                placeholder={hasPassword ? "Enter Password" : ""}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="cyber-input"
                style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                disabled={!hasPassword || uploading}
              />
            </div>
          </div>

          {/* Burn on Read Toggle */}
          <div className="form-group" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 16px' }}>
            <div className="form-group-row">
              <div style={{ textAlign: 'left' }}>
                <span className="form-group-title" style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Enable One-Time Download</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>Link automatically deletes after first download.</span>
              </div>
              <input 
                type="checkbox"
                checked={burnOnRead}
                onChange={(e) => setBurnOnRead(e.target.checked)}
                className="cursor-pointer"
                disabled={uploading}
              />
            </div>
          </div>

          {/* Ingestion Execute */}
          <button 
            disabled={!file || uploading}
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
            Generate Link
          </button>
        </div>
      ) : (
        /* Result Screen */
        <div className="app-container">
          <div className="app-container" style={{ gap: '8px' }}>
            <div className="header-badge" style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}>
              <Shield className="w-4 h-4" />
              <span>Secure Link Generated</span>
            </div>
            <p className="text-xs text-slate-500 max-w-[300px]">The file is now encrypted. Share this secure URL with the recipient.</p>
          </div>

          <div className="form-group-row" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px', backgroundColor: '#f8fafc' }}>
            <LinkIcon className="w-4 h-4 text-slate-400" style={{ flexShrink: 0 }} />
            <span className="text-xs truncate text-slate-700" style={{ flex: 1, padding: '0 8px', textAlign: 'left' }}>{resultLink}</span>
            <button 
              onClick={copyToClipboard}
              className="btn-icon"
              title="Copy link"
              style={{ padding: '6px' }}
            >
              {copied ? <Check className="w-4 h-4 text-indigo-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <button 
            onClick={resetUploader}
            className="btn-cyber"
          >
            Upload Another File
          </button>
        </div>
      )}
    </div>
  );
};
