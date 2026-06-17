import React, { useEffect, useRef } from 'react';

export interface ConsoleLogEntry {
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface ConsolePanelProps {
  logs: ConsoleLogEntry[];
  onClear: () => void;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ logs, onClear }) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLogPrefix = (type: string) => {
    switch (type) {
      case 'success': return '[OK]';
      case 'warn': return '[WRN]';
      case 'error': return '[ERR]';
      default: return '[INF]';
    }
  };

  const getLogColorVar = (type: string) => {
    switch (type) {
      case 'success': return 'var(--log-success)';
      case 'warn': return 'var(--log-warn)';
      case 'error': return 'var(--log-error)';
      default: return 'var(--log-info)';
    }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-header-title">
          <div className="terminal-indicator"></div>
          <span>System Activity Log</span>
        </div>
        <button 
          onClick={onClear}
          className="terminal-clear-btn"
        >
          [Clear Logs]
        </button>
      </div>
      
      <div className="terminal-screen">
        <div className="terminal-logs-wrapper">
          {logs.map((log, index) => (
            <div key={index} className="terminal-row">
              <div className="terminal-row-content">
                <span className="terminal-time">[{log.timestamp}]</span>
                <span style={{ color: getLogColorVar(log.type) }} className="terminal-prefix">
                  {getLogPrefix(log.type)}
                </span>
                <span className="terminal-message">{log.message}</span>
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="terminal-empty">
              System ready. Awaiting file transactions...
            </div>
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
};
