import { useState, useEffect, useRef, useCallback } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import type { ConsoleLogEntry } from './components/ConsolePanel';
import { UploadPanel } from './components/UploadPanel';
import { VaultStatus } from './components/VaultStatus';
import { DownloadChallenge } from './components/DownloadChallenge';
import { Terminal, Shield, AlertOctagon } from 'lucide-react';

interface SavedLink {
  uuid: string;
  fileName: string;
  expiresAt: string;
  burnOnRead: boolean;
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'download'>('dashboard');
  const [vaultUuid, setVaultUuid] = useState<string | null>(null);
  
  const [links, setLinks] = useState<SavedLink[]>(() => {
    const saved = localStorage.getItem('seculink_active_links');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed parsing saved links.', e);
      }
    }
    return [];
  });
  
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [isPurging, setIsPurging] = useState(false);
  const purgeTimeoutRef = useRef<number | null>(null);
  const welcomedRef = useRef(false);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const vaultMatch = hash.match(/^#\/vault\/([0-9a-fA-F-]{36})$/);
      if (vaultMatch && vaultMatch[1]) {
        setVaultUuid(vaultMatch[1]);
        setView('download');
      } else {
        setVaultUuid(null);
        setView('dashboard');
      }
    };

    handleHashChange(); 
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const addLog = useCallback((type: ConsoleLogEntry['type'], message: string) => {
    const time = new Date().toTimeString().split(' ')[0];
    setLogs((prev) => [...prev, { timestamp: time, type, message }]);
  }, []);

  useEffect(() => {
    localStorage.setItem('seculink_active_links', JSON.stringify(links));
  }, [links]);

  useEffect(() => {
    if (!welcomedRef.current) {
      addLog('info', 'SecuLink Secure File Vault service initialized.');
      addLog('success', 'Ready for secure upload. Default expiration set to 60 minutes.');
      welcomedRef.current = true;
    }
  }, [addLog]);

  useEffect(() => {
    return () => {
      if (purgeTimeoutRef.current) {
        window.clearTimeout(purgeTimeoutRef.current);
      }
    };
  }, []);

  const handleUploadSuccess = useCallback((newLink: SavedLink) => {
    setLinks((prev) => [newLink, ...prev]);
  }, []);

  const handleRemoveLink = useCallback((uuid: string) => {
    setLinks((prev) => prev.filter((l) => l.uuid !== uuid));
    addLog('warn', `Removed link listing: ${uuid}`);
  }, [addLog]);

  const handlePurgeAll = useCallback(() => {
    setLinks([]);
    setIsPurging(true);
    if (purgeTimeoutRef.current) {
      window.clearTimeout(purgeTimeoutRef.current);
    }
    purgeTimeoutRef.current = window.setTimeout(() => {
      setIsPurging(false);
      addLog('info', 'All active storage allocations and metadata successfully purged.');
    }, 2000);
  }, [addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const navigateToDashboard = useCallback(() => {
    window.location.hash = '';
  }, []);

  return (
    <div className="app-container">
      {/* Purge / Wiping Overlay */}
      {isPurging && (
        <div className="purge-overlay">
          <AlertOctagon className="purge-icon animate-pulse" />
          <h2 className="purge-title">Wiping Vault Shares</h2>
          <p className="purge-subtitle">Permanently shredding keys and deleting active files from server volumes...</p>
        </div>
      )}

      {/* Main Professional Header */}
      <header className="main-header">
        <div className="header-logo-container" onClick={navigateToDashboard}>
          <div className="logo-icon-wrapper">
            <Shield className="logo-icon" />
          </div>
          <div>
            <h1 className="brand-title">SecuLink</h1>
            <p className="brand-subtitle">
              Zero-Knowledge Ephemeral File Sharing Vault
            </p>
          </div>
        </div>
        <div className="status-badge">
          <span className="status-indicator"></span>
          <span>Security Protocol Active</span>
          <span className="divider">|</span>
          <span>Local Node Online</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {view === 'dashboard' ? (
          <>
            <UploadPanel 
              addLog={addLog} 
              onUploadSuccess={handleUploadSuccess} 
            />
            <VaultStatus 
              links={links} 
              onRemoveLink={handleRemoveLink} 
              onNukeAll={handlePurgeAll}
              addLog={addLog}
            />
            <ConsolePanel 
              logs={logs} 
              onClear={clearLogs} 
            />
          </>
        ) : (
          /* Download Challenge Portal */
          <div className="download-challenge-wrapper">
            <DownloadChallenge 
              uuid={vaultUuid!} 
              onBackToDashboard={navigateToDashboard} 
            />
          </div>
        )}
      </main>

      <footer className="main-footer">
        <div>SecuLink Protected File Vault System</div>
        <div className="footer-crypto-info">
          <Terminal className="footer-icon" />
          <span>AES-256-GCM / PBKDF2 Key Splitting Protocol</span>
        </div>
      </footer>
    </div>
  );
}
