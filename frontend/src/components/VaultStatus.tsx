import React, { useState, useEffect } from 'react';
import { Trash2, Copy, Check, History, Clock, AlertCircle, FileText } from 'lucide-react';
import type { ConsoleLogEntry } from './ConsolePanel';

interface SavedLink {
  uuid: string;
  fileName: string;
  expiresAt: string;
  burnOnRead: boolean;
}

interface VaultStatusProps {
  links: SavedLink[];
  onRemoveLink: (uuid: string) => void;
  onNukeAll: () => void;
  addLog: (type: ConsoleLogEntry['type'], message: string) => void;
}

interface AuditLog {
  id: number;
  fileId: string;
  action: string;
  ipAddress: string;
  details: string;
  createdAt: string;
}

export const VaultStatus: React.FC<VaultStatusProps> = ({ links, onRemoveLink, onNukeAll, addLog }) => {
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const isLinkExpired = (expiresAtStr: string) => {
    return now > new Date(expiresAtStr);
  };

  const copyLink = (uuid: string) => {
    const secureUrl = `${window.location.origin}${window.location.pathname}#/vault/${uuid}`;
    navigator.clipboard.writeText(secureUrl);
    setCopiedUuid(uuid);
    addLog('success', `[CLIPBOARD] Link copied for slug: ${uuid}`);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  const fetchAuditLogs = async (uuid: string) => {
    if (selectedUuid === uuid) {
      setSelectedUuid(null);
      setAuditLogs([]);
      return;
    }

    setLoadingLogs(true);
    setSelectedUuid(uuid);
    addLog('info', `[NETWORK] Fetching security audit logs for slug: ${uuid}...`);
    try {
      const response = await fetch(`http://localhost:5000/api/vault/logs/${uuid}`);
      if (!response.ok) {
        throw new Error('Could not retrieve audit history.');
      }
      const data = await response.json();
      setAuditLogs(data.logs);
      addLog('success', `[AUDIT] Retained ${data.logs.length} logged actions.`);
    } catch (error: any) {
      console.error(error);
      setAuditLogs([]);
      addLog('error', `[AUDIT ERROR] Failed to fetch security heartbeat: ${error.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handlePurgeClick = async () => {
    if (!window.confirm("WARNING: THIS WILL SHRED ALL ACTIVE FILES ON THE SERVER AND METADATA PERMANENTLY. PROCEED?")) {
      return;
    }
    
    setPurging(true);
    addLog('warn', `[PURGE] Triggering system-wide wipe cascade...`);
    try {
      const response = await fetch('http://localhost:5000/api/vault/nuke', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Purge server command failed.');
      }
      
      const result = await response.json();
      addLog('error', `[PURGE COMPLETE] ${result.message}`);
      onNukeAll();
      setSelectedUuid(null);
      setAuditLogs([]);
    } catch (error: any) {
      console.error(error);
      addLog('error', `[PURGE ERROR] Wipe aborted: ${error.message}`);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="glass-panel">
      {links.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: '16px' }}>
          <button 
            disabled={purging}
            onClick={handlePurgeClick}
            className="flex items-center justify-center space-x-1.5 text-xs border border-red-200 hover:bg-red-50 hover:text-red-700 px-3 py-1.5 rounded transition text-red-600 cursor-pointer bg-white font-medium shadow-sm"
            style={{ border: '1px solid rgba(239, 68, 68, 0.2)', backgroundColor: 'rgba(239, 68, 68, 0.04)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Purge All Shares</span>
          </button>
        </div>
      )}

      {links.length === 0 ? (
        <div className="text-center py-8 flex flex-col items-center justify-center space-y-3 w-full">
          <AlertCircle className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="text-center w-full">
            <p className="text-sm font-semibold text-slate-700 text-center">No active file shares</p>
            <p className="text-xs text-slate-400 text-center mt-1">Upload a file to generate a secure sharing link.</p>
          </div>
        </div>
      ) : (
        <div className="shares-list">
          {links.map((link) => {
            const expired = isLinkExpired(link.expiresAt);
            return (
              <div 
                key={link.uuid} 
                className="share-card"
              >
                <div className="share-card-info">
                  <FileText className="w-5 h-5 text-slate-400 mx-auto" />
                  
                  <div className="text-center w-full">
                    <div className="share-card-title">
                      {link.fileName}
                    </div>
                    <div className="share-card-meta">
                      <span className="flex items-center justify-center space-x-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Expires: {new Date(link.expiresAt).toLocaleTimeString()}</span>
                      </span>
                      {link.burnOnRead && (
                        <span className="share-card-badge">
                          One-Time Download
                        </span>
                      )}
                      <span className="font-bold block mt-1 text-center" style={{ color: expired ? '#ef4444' : '#22c55e', fontSize: '11px' }}>
                        {expired ? 'Expired' : 'Active'}
                      </span>
                    </div>
                  </div>

                  <div className="share-actions">
                    <button
                      onClick={() => copyLink(link.uuid)}
                      className="btn-icon"
                      title="Copy Share Link"
                    >
                      {copiedUuid === link.uuid ? <Check className="w-4 h-4 text-indigo-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    
                    <button
                      onClick={() => fetchAuditLogs(link.uuid)}
                      className="btn-icon"
                      style={selectedUuid === link.uuid ? { backgroundColor: '#4f46e5', borderColor: '#4f46e5', color: '#ffffff' } : {}}
                      title="Audit logs"
                    >
                      <History className="w-4 h-4" />
                      <span className="text-xxs font-semibold" style={selectedUuid === link.uuid ? { color: '#ffffff', marginLeft: '4px' } : { marginLeft: '4px' }}>Logs</span>
                    </button>

                    <button
                      onClick={() => onRemoveLink(link.uuid)}
                      className="btn-icon"
                      title="Remove local listing"
                    >
                      <Trash2 className="w-4 h-4 hover:text-red-600" />
                    </button>
                  </div>
                </div>

                {selectedUuid === link.uuid && (
                  <div className="audit-logs-box">
                    <div className="text-xs font-semibold text-slate-700 text-center">Security Audit Logs</div>
                    {loadingLogs ? (
                      <div className="text-xs text-slate-400 animate-pulse text-center">Loading audit logs...</div>
                    ) : auditLogs.length === 0 ? (
                      <div className="text-xs text-slate-400 text-center">No logs generated or database shredded.</div>
                    ) : (
                      <div className="audit-logs-wrapper">
                        {auditLogs.map((log) => (
                          <div key={log.id} className="audit-log-row">
                            <div className="flex flex-col items-center text-center space-y-0.5">
                              <span>[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                              <span>IP: {log.ipAddress}</span>
                            </div>
                            <div className="text-center font-semibold text-slate-700">
                              <span>{log.action} : </span>
                              <span>{log.details}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
