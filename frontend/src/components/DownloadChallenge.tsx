import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Key, Download, RefreshCw, AlertTriangle, FileCheck, Clock } from 'lucide-react';

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

  const handleDownloadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(`http://localhost:5000/api/vault/download/${uuid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to authenticate download.');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
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
    } catch (err: any) {
      console.error(err);
      setDownloadError(err.message || 'Decryption cascade failure.');
    } finally {
      setDownloading(false);
    }
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
          <h2 className="brand-title" style={{ fontSize: '18px', textAlign: 'center', color: '#ef4444' }}>Link Expired</h2>
          <p className="text-xs text-slate-500 text-center">{error || 'This file share link has expired or has been deleted.'}</p>
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

  return (
    <div className="glass-panel max-w-md w-full mx-auto flex flex-col items-center justify-center space-y-6 text-center">
      <div className="flex items-center justify-center space-x-2 border-b border-slate-200 pb-4 w-full text-center">
        <Shield className="text-indigo-600 w-5 h-5 mx-auto" />
        <span className="brand-title" style={{ fontSize: '15px', textAlign: 'center' }}>Secure File Download</span>
      </div>

      {!downloadSuccess ? (
        <form onSubmit={handleDownloadSubmit} className="flex flex-col space-y-5 w-full items-center justify-center">
          {/* File Metadata Overview */}
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg space-y-2 w-full text-center">
            <div className="text-xxs text-slate-500 tracking-wider font-semibold text-center">FILE DETAILS:</div>
            <div className="text-sm font-bold text-slate-800 truncate text-center max-w-[280px] mx-auto">{meta.fileName}</div>
            
            <div className="grid grid-cols-2 gap-2 text-xxs text-slate-500 pt-2 border-t border-slate-200 w-full text-center">
              <div className="text-center">SIZE: {getReadableSize(meta.fileSize)}</div>
              <div className="text-center">ONE-TIME DOWNLOAD: {meta.burnOnRead ? 'YES' : 'NO'}</div>
              <div className="col-span-2 text-indigo-600 flex items-center justify-center mt-1 font-semibold text-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                <span>EXPIRES IN: {timeRemaining}</span>
              </div>
            </div>
          </div>

          {/* Password Input Drawer */}
          {meta.hasPassword ? (
            <div className="flex flex-col space-y-2 w-full items-center justify-center text-center">
              <label className="text-xs font-semibold text-slate-700 tracking-wider flex items-center justify-center">
                <Key className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
                PASSWORD PROTECTION
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
            <div className="text-center py-2 bg-slate-50 border border-slate-200 rounded p-3 text-xxs text-slate-500 max-w-xs w-full">
              No password required. File is ready for download.
            </div>
          )}

          {/* Warning indicators for Burn on Read */}
          {meta.burnOnRead && (
            <div className="bg-red-50 border border-red-200 p-3 rounded flex flex-col items-center justify-center text-center max-w-xs w-full">
              <AlertTriangle className="w-5 h-5 text-red-500 mb-1.5" />
              <div className="text-xxs text-red-600 leading-normal text-center font-medium">
                One-Time Download active: the file will be permanently deleted immediately after downloading.
              </div>
            </div>
          )}

          {/* Action Trigger */}
          <button 
            type="submit"
            disabled={downloading}
            className="btn-cyber flex items-center justify-center space-x-2 py-3"
          >
            {downloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Decrypting and downloading...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download File</span>
              </>
            )}
          </button>
        </form>
      ) : (
        /* Success Screen */
        <div className="flex flex-col space-y-6 py-4 text-center items-center justify-center w-full">
          <div className="w-14 h-14 mx-auto rounded-full border border-green-200 bg-green-50 flex items-center justify-center">
            <FileCheck className="text-green-600 w-6 h-6" />
          </div>
          
          <div className="space-y-1 text-center w-full">
            <h3 className="brand-title" style={{ fontSize: '16px', textAlign: 'center', color: '#22c55e' }}>Download Successful</h3>
            <p className="text-xs text-slate-500 text-center">Your file has been downloaded.</p>
          </div>

          {meta.burnOnRead && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded text-xxs text-amber-700 leading-normal text-center max-w-xs w-full">
              <div className="font-bold mb-1 text-center">One-Time File Shredded:</div>
              This file has been permanently deleted from storage. Subsequent downloads will fail.
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
      )}
    </div>
  );
};
