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
  const [showApp, setShowApp] = useState(false);

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

  const navigateToDashboard = useCallback(() => { 
    window.location.hash = ''; 
    setShowApp(false);
  }, []);

  return (
    <div className="app-container">
      {isPurging && (
        <div className="purge-overlay">
          <AlertOctagon className="purge-icon animate-pulse" />
          <h2 className="purge-title">Wiping Vault Shares</h2>
          <p className="purge-subtitle">Permanently shredding keys and deleting active files from server volumes…</p>
        </div>
      )}
      <div className="floating-controls-widget">
        <div className="status-badge" style={{ border: 'none', background: 'transparent', padding: 0 }}>
          <span className="status-indicator"></span>
          <span className="status-text-label">Vault Active</span>
        </div>
        <button
          className="btn-theme-toggle"
          onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon className="theme-icon" /> : <Sun className="theme-icon" />}
        </button>
      </div>

      <div className="brand-header-section">
        <h1 className="brand-logo-text" onClick={navigateToDashboard}>SecuLink</h1>
        <p className="brand-logo-subtitle">Zero-Knowledge Encrypted Ephemeral Vault</p>
      </div>

      {view === 'dashboard' ? (
        !showApp ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div className="instructions-container">
                <h2 className="instructions-title">How does it work?</h2>
                <div className="instructions-list">
                  <div className="instruction-item">
                    <span className="step-num">1</span>
                    <div className="step-content">
                      <h3 className="step-title">Upload Your File</h3>
                      <p className="step-desc">Securely upload your file, note, image, or document.</p>
                    </div>
                  </div>
                  <div className="instruction-item">
                    <span className="step-num">2</span>
                    <div className="step-content">
                      <h3 className="step-title">Customize Security Controls</h3>
                      <p className="step-desc">Choose an expiry time, add a password, enable one-time downloads, restrict access by IP or location, require email verification, or enable secure viewing mode.</p>
                    </div>
                  </div>
                  <div className="instruction-item">
                    <span className="step-num">3</span>
                    <div className="step-content">
                      <h3 className="step-title">Share Securely</h3>
                      <p className="step-desc">Generate a private link and instantly share it via URL or QR code.</p>
                    </div>
                  </div>
                  <div className="instruction-item">
                    <span className="step-num">4</span>
                    <div className="step-content">
                      <h3 className="step-title">Verify & Access</h3>
                      <p className="step-desc">Recipients complete any required security checks such as passwords, OTP verification, IP validation, or location restrictions before viewing the content.</p>
                    </div>
                  </div>
                  <div className="instruction-item">
                    <span className="step-num">5</span>
                    <div className="step-content">
                      <h3 className="step-title">Automatic Shredding</h3>
                      <p className="step-desc">Files are automatically deleted when they expire, reach their download limit, or are destroyed using Burn-on-Read mode.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '36px', marginBottom: '64px' }}>
              <button
                onClick={() => setShowApp(true)}
                className="btn-cyber"
                style={{
                  width: 'auto',
                  padding: '14px 48px',
                  borderRadius: '30px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  boxShadow: '0 4px 16px var(--color-accent-glow)'
                }}
              >
                Try Now
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', maxWidth: '680px', margin: '0 auto 16px auto' }}>
              <button
                onClick={() => setShowApp(false)}
                className="btn-icon"
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
              >
                ← Back to Home
              </button>
            </div>

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

            <main className="main-content">
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
            </main>
          </>
        )
      ) : (
        <main className="main-content">
          <div className="download-challenge-wrapper">
            <DownloadChallenge uuid={vaultUuid!} onBackToDashboard={navigateToDashboard} />
          </div>
        </main>
      )}

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
