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

  const getLogColor = (type: string) => {
    switch (type) {
      case 'success': return '#22c55e'; // green-500
      case 'warn': return '#eab308'; // yellow-500
      case 'error': return '#ef4444'; // red-500
      default: return '#38bdf8'; // sky-400
    }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-header-title">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-xs text-slate-200 font-semibold tracking-wide">System Activity Log</span>
        </div>
        <button 
          onClick={onClear}
          className="text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer bg-transparent border-0 outline-none"
        >
          [Clear Logs]
        </button>
      </div>
      
      <div className="terminal-screen">
        <div className="flex flex-col space-y-1.5 items-start justify-start w-full">
          {logs.map((log, index) => (
            <div key={index} className="terminal-row w-full">
              <div className="flex items-center justify-start space-x-2 leading-relaxed text-left w-full text-xs">
                <span className="text-slate-500">[{log.timestamp}]</span>
                <span style={{ color: getLogColor(log.type) }} className="font-semibold">
                  {getLogPrefix(log.type)}
                </span>
                <span className="text-slate-300 break-all text-left">{log.message}</span>
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-slate-500 italic text-left w-full text-xs py-2">
              System ready. Awaiting file transactions...
            </div>
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
};
