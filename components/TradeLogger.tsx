
import React, { useEffect, useRef } from 'react';

export interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
}

interface TradeLoggerProps {
  logs: LogEntry[];
  isVisible: boolean;
  onClose: () => void;
  onClear: () => void;
}

const TradeLogger: React.FC<TradeLoggerProps> = ({ logs, isVisible, onClose, onClear }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-12 right-1 md:top-14 md:right-4 w-60 md:w-96 h-24 md:h-28 bg-[#0d1117]/95 backdrop-blur shadow-2xl border border-[#30363d] rounded-lg z-50 flex flex-col font-mono text-xs animate-in slide-in-from-right-10 fade-in duration-200">
      
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] shrink-0">
        <div className="flex items-center gap-2">
           <div className="flex gap-1.5">
             <div className="w-2 h-2 rounded-full bg-[#da3633]"></div>
             <div className="w-2 h-2 rounded-full bg-[#d29922]"></div>
             <div className="w-2 h-2 rounded-full bg-[#3fb950]"></div>
           </div>
           <span className="ml-2 font-bold text-[#8b949e] tracking-wider text-[10px]">CONSOLE</span>
        </div>
        <div className="flex items-center gap-2">
            <button 
                onClick={onClear}
                className="text-[10px] text-[#8b949e] hover:text-[#da3633] transition-colors uppercase font-bold px-2"
                title="Clear Logs"
            >
                Clear
            </button>
            <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors p-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
      </div>
      
      {/* Logs Body */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar bg-[#0d1117]">
        {logs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-[#8b949e] opacity-30 italic text-[10px]">
                <span>System ready.</span>
            </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-2 items-start border-l-2 border-transparent hover:bg-[#161b22] px-1 py-0.5 rounded transition-colors group text-[10px] md:text-xs">
             <span className="text-[#8b949e] opacity-40 whitespace-nowrap text-[9px] mt-0.5 select-none">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
             </span>
             <span className={`break-words flex-1 leading-tight ${
               log.type === 'success' ? 'text-[#3fb950]' : 
               log.type === 'error' ? 'text-[#da3633]' : 'text-[#c9d1d9]'
             }`}>
               {log.type === 'error' && <span className="font-bold mr-1">[ERR]</span>}
               {log.type === 'success' && <span className="font-bold mr-1">[OK]</span>}
               {log.type === 'info' && <span className="text-[#58a6ff] mr-1">›</span>}
               {log.message}
             </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default TradeLogger;
