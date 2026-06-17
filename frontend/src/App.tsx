import { useState, useEffect, useRef, useCallback } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import type { ConsoleLogEntry } from './components/ConsolePanel';
import { UploadPanel } from './components/UploadPanel';
import { VaultStatus } from './components/VaultStatus';
import { DownloadChallenge } from './components/DownloadChallenge';
import { Terminal, AlertOctagon, Sun, Moon } from 'lucide-react';

interface SavedLink {
  uuid: string;
  fileName: string;
  expiresAt: string;
  burnOnRead: boolean;
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'download'>('dashboard');
  const [vaultUuid, setVaultUuid] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'shares' | 'logs'>('upload');

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('seculink_theme');
    return (saved === 'dark' || saved === 'light') ? saved : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('seculink_theme', theme);
  }, [theme]);

  const [links, setLinks] = useState<SavedLink[]>(() => {
    const saved = localStorage.getItem('seculink_active_links');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error('Failed parsing saved links.', e); }
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
      addLog('info', 'SecuLink secure vault initialized.');
      addLog('success', 'Ready for secure upload. Default expiry: 60 minutes.');
      welcomedRef.current = true;
    }
  }, [addLog]);

  useEffect(() => {
    return () => { if (purgeTimeoutRef.current) window.clearTimeout(purgeTimeoutRef.current); };
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
    if (purgeTimeoutRef.current) window.clearTimeout(purgeTimeoutRef.current);
    purgeTimeoutRef.current = window.setTimeout(() => {
      setIsPurging(false);
      addLog('info', 'All allocations and metadata permanently purged.');
    }, 2000);
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  const navigateToDashboard = useCallback(() => { window.location.hash = ''; }, []);

  return (
    <div className="app-container">
      {/* Purge Overlay */}
      {isPurging && (
        <div className="purge-overlay">
          <AlertOctagon className="purge-icon animate-pulse" />
          <h2 className="purge-title">Wiping Vault Shares</h2>
          <p className="purge-subtitle">Permanently shredding keys and deleting active files from server volumes…</p>
        </div>
      )}

      {/* Theme Toggle in top-right */}
      <button
        className="btn-theme-toggle"
        onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 100 }}
      >
        {theme === 'light' ? <Moon className="theme-icon" /> : <Sun className="theme-icon" />}
      </button>

      {/* Header Title & How it works instructions */}
      <div style={{ textAlign: 'center', marginTop: '16px', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '3.2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '54px', letterSpacing: '-0.025em' }}>SecuLink</h1>
        
        {view === 'dashboard' && (
          <div className="instructions-container">
            <h2 className="instructions-title">How does it work?</h2>
            <div className="instructions-list">
              <div className="instruction-item">
                <span className="step-num">1</span>
                <div className="step-content">
                  <h3 className="step-title">Upload Your File</h3>
                  <p className="step-desc">Add the file you want to share securely.</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Set Protection Options</h3>
                  <p className="step-desc">Choose an expiry time, add a password, or enable a one-time download for extra security.</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Share the Link</h3>
                  <p className="step-desc">Send the secure link to anyone you want to access the file.</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="step-num">4</span>
                <div className="step-content">
                  <h3 className="step-title">Recipient Downloads</h3>
                  <p className="step-desc">The recipient opens the link and enters the password (if required).</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="step-num">5</span>
                <div className="step-content">
                  <h3 className="step-title">Auto-Delete</h3>
                  <p className="step-desc">The file automatically disappears once it expires or reaches its download limit.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      {view === 'dashboard' && (
        <nav className="navbar">
          <div className="nav-tabs-wrapper">
            <button
              className={`nav-tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <span>Upload File</span>
            </button>
            <button
              className={`nav-tab ${activeTab === 'shares' ? 'active' : ''}`}
              onClick={() => setActiveTab('shares')}
            >
              <span>Active Shares</span>
            </button>
            <button
              className={`nav-tab ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <span>Activity Log</span>
            </button>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="main-content">
        {view === 'dashboard' ? (
          <>
            {activeTab === 'upload' && (
              <UploadPanel addLog={addLog} onUploadSuccess={handleUploadSuccess} />
            )}
            {activeTab === 'shares' && (
              <VaultStatus
                links={links}
                onRemoveLink={handleRemoveLink}
                onNukeAll={handlePurgeAll}
                addLog={addLog}
              />
            )}
            {activeTab === 'logs' && (
              <ConsolePanel logs={logs} onClear={clearLogs} />
            )}
          </>
        ) : (
          <div className="download-challenge-wrapper">
            <DownloadChallenge uuid={vaultUuid!} onBackToDashboard={navigateToDashboard} />
          </div>
        )}
      </main>

      <footer className="main-footer">
        <span>SecuLink Protected File Vault</span>
        <div className="footer-crypto-info">
          <Terminal className="footer-icon" />
          <span>AES-256-GCM / PBKDF2 Key Splitting</span>
        </div>
      </footer>
    </div>
  );
}
