
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { MarketTicker } from '../types';
import { getBinanceMarkets } from '../services/binance';

interface MarketListProps {
  onSelect: (ticker: MarketTicker) => void;
  activeSymbol: string;
  refreshTrigger?: number;
  onListUpdate?: (markets: MarketTicker[]) => void;
}

type SortMode = 'GAINS' | 'VOLUME';

const MarketList: React.FC<MarketListProps> = ({ onSelect, activeSymbol, refreshTrigger = 0, onListUpdate }) => {
  const [markets, setMarkets] = useState<MarketTicker[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>('GAINS');
  
  // Use a ref to store the latest market data map for efficient updates
  const marketMapRef = useRef<Map<string, MarketTicker>>(new Map());

  // Handle Manual Refresh
  useEffect(() => {
    if (refreshTrigger === 0) return;

    const refresh = async () => {
      try {
        const data = await getBinanceMarkets();
        // Update map with fresh snapshot
        data.forEach(m => marketMapRef.current.set(m.symbol, m));
        // Force update state
        setMarkets(Array.from(marketMapRef.current.values()));
      } catch (e) {
        console.error("Failed to refresh markets", e);
      }
    };
    refresh();
  }, [refreshTrigger]);

  useEffect(() => {
    let ws: WebSocket | null = null;

    const init = async () => {
      // 1. Initial REST Fetch
      const initialData = await getBinanceMarkets();
      initialData.forEach(m => marketMapRef.current.set(m.symbol, m));
      setMarkets(Array.from(marketMapRef.current.values()));
      setLoading(false);

      // 2. WebSocket Subscription for !miniTicker@arr
      ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

      ws.onmessage = (event) => {
        try {
          const tickers = JSON.parse(event.data);
          // Only update if we have the market in our list (USDT pairs from initial fetch)
          let hasUpdates = false;

          tickers.forEach((t: any) => {
            const symbol = t.s;
            if (marketMapRef.current.has(symbol)) {
              const current = marketMapRef.current.get(symbol)!;
              marketMapRef.current.set(symbol, {
                ...current,
                price: parseFloat(t.c),
                changePercent: ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100,
                // volume: parseFloat(t.q) // Quote volume
              });
              hasUpdates = true;
            }
          });

          if (hasUpdates) {
             // Throttled update or just set state (React batches state updates usually, but 1000 tickers is heavy)
             // For S-Tier performance, we might want to throttle this, but for < 100 visible items it's okay.
             // We only update the state array.
             setMarkets(Array.from(marketMapRef.current.values()));
          }
        } catch (e) {
          console.error(e);
        }
      };
    };

    init();

    return () => {
      if (ws) ws.close();
    };
  }, []);

  const filteredMarkets = useMemo(() => {
    // Filter first
    const list = markets.filter(m => m.symbol.toLowerCase().includes(search.toLowerCase()));
    
    // Then sort based on mode
    if (sortMode === 'GAINS') {
      return list.sort((a, b) => b.changePercent - a.changePercent);
    } else {
      return list.sort((a, b) => b.volume - a.volume);
    }
  }, [markets, search, sortMode]);

  // Optimization: Only notify parent if the order of symbols changes to prevent massive re-renders
  const prevSymbolsRef = useRef<string>('');
  useEffect(() => {
      if (!onListUpdate) return;
      
      const currentSymbols = filteredMarkets.map(m => m.symbol).join(',');
      if (currentSymbols !== prevSymbolsRef.current) {
          prevSymbolsRef.current = currentSymbols;
          onListUpdate(filteredMarkets);
      }
  }, [filteredMarkets, onListUpdate]);

  // --- Keyboard Navigation ---
  // Store current props/state in ref to avoid re-binding effect constantly on market updates
  const stateRef = useRef({ filteredMarkets, activeSymbol, onSelect });
  useEffect(() => {
    stateRef.current = { filteredMarkets, activeSymbol, onSelect };
  }, [filteredMarkets, activeSymbol, onSelect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { filteredMarkets, activeSymbol, onSelect } = stateRef.current;
      
      const activeEl = document.activeElement;
      const isInput = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;
      // Identify the search input specifically to allow nav while filtering
      const isSearchInput = activeEl?.getAttribute('placeholder') === 'Search Coin...';

      // If user is typing in Trade Form inputs (risk, RR, etc), do not hijack arrows.
      // But allow if they are in the search box or body.
      if (isInput && !isSearchInput) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        const currentIndex = filteredMarkets.findIndex(m => m.symbol === activeSymbol);
        
        let nextIndex = currentIndex;
        if (e.key === 'ArrowDown') {
            nextIndex = currentIndex < filteredMarkets.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
        }

        if (nextIndex !== currentIndex && nextIndex >= 0) {
            const nextTicker = filteredMarkets[nextIndex];
            onSelect(nextTicker);
            
            // Scroll to item
            const el = document.getElementById(`market-item-${nextTicker.symbol}`);
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="w-full md:w-60 h-full border-r border-[#30363d] bg-[#0d1117] flex flex-col z-10">
      <div className="p-4 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold tracking-wider text-[#8b949e]">MARKETS</h2>
          <div className="flex gap-1 bg-[#0d1117] p-0.5 rounded border border-[#30363d]">
            <button 
              onClick={() => setSortMode('GAINS')}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${sortMode === 'GAINS' ? 'bg-[#238636] text-white' : 'text-[#8b949e] hover:text-white'}`}
            >
              GAINS
            </button>
            <button 
              onClick={() => setSortMode('VOLUME')}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${sortMode === 'VOLUME' ? 'bg-[#1f6feb] text-white' : 'text-[#8b949e] hover:text-white'}`}
            >
              VOL
            </button>
          </div>
        </div>
        <input 
          type="text"
          placeholder="Search Coin..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-white text-xs font-mono focus:border-[#58a6ff] focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-4 text-center text-[#8b949e] text-xs">Loading Markets...</div>
        ) : (
          <div className="divide-y divide-[#21262d]">
            {filteredMarkets.map(ticker => {
              const isPositive = ticker.changePercent >= 0;
              const isActive = ticker.symbol === activeSymbol;
              
              // Dynamic precision for list
              const priceDisplay = ticker.price < 1 ? ticker.price.toFixed(6) : ticker.price.toFixed(2);
              
              // Volume display formatting
              let volDisplay = '';
              if (ticker.volume >= 1000000000) {
                 volDisplay = (ticker.volume / 1000000000).toFixed(1) + 'B';
              } else if (ticker.volume >= 1000000) {
                 volDisplay = (ticker.volume / 1000000).toFixed(1) + 'M';
              } else if (ticker.volume >= 1000) {
                 volDisplay = (ticker.volume / 1000).toFixed(1) + 'K';
              } else {
                 volDisplay = ticker.volume.toFixed(0);
              }

              return (
                <div 
                  key={ticker.symbol}
                  id={`market-item-${ticker.symbol}`}
                  onClick={() => onSelect(ticker)}
                  className={`px-3 py-2 cursor-pointer hover:bg-[#161b22] transition-colors flex justify-between items-center ${isActive ? 'bg-[#1f242c] border-l-2 border-[#58a6ff]' : 'border-l-2 border-transparent'}`}
                >
                  <div className="truncate pr-1">
                    <div className={`font-bold text-xs ${isActive ? 'text-white' : 'text-[#c9d1d9]'}`}>
                      {ticker.symbol.replace('USDT', '')}
                    </div>
                    <div className="text-[9px] text-[#8b949e] font-mono mt-0.5">
                      V: {volDisplay}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-white font-mono text-xs">
                      {priceDisplay}
                    </div>
                    <div className={`text-[10px] font-mono mt-0.5 ${isPositive ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                      {isPositive ? '+' : ''}{ticker.changePercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketList;
