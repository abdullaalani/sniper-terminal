
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';
import { TradeHistoryItem } from '../types';
import { THEME } from '../constants';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: TradeHistoryItem[];
  onClear: () => void;
}

// --- Helper Components ---

const StatCard = ({ label, value, subValue, colorClass = "text-white" }: { label: string, value: string, subValue?: string, colorClass?: string }) => (
  <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg flex flex-col justify-between h-24">
    <div className="text-[10px] uppercase font-bold text-[#8b949e] tracking-wider">{label}</div>
    <div>
        <div className={`text-2xl font-mono font-bold ${colorClass}`}>{value}</div>
        {subValue && <div className="text-xs text-[#8b949e] mt-1">{subValue}</div>}
    </div>
  </div>
);

const HighlightCard = ({ title, trade }: { title: string, trade: TradeHistoryItem | null }) => {
    if (!trade) return (
        <div className="bg-[#161b22] border border-[#30363d] p-3 rounded-lg h-20 flex items-center justify-center text-[#8b949e] text-xs italic">
            No Data
        </div>
    );
    const isWin = trade.netPnl >= 0;
    return (
        <div className="bg-[#161b22] border border-[#30363d] p-3 rounded-lg flex flex-col justify-center h-24 relative overflow-hidden group">
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${isWin ? 'bg-[#3fb950]' : 'bg-[#da3633]'}`}></div>
            <div className="text-[10px] uppercase font-bold text-[#8b949e] mb-1 pl-2">{title}</div>
            <div className="flex justify-between items-end pl-2">
                <div>
                    <div className="font-bold text-white text-sm">{trade.symbol}</div>
                    <div className="text-[10px] text-[#8b949e]">{new Date(trade.exitTime).toLocaleDateString()}</div>
                </div>
                <div className={`font-mono font-bold text-lg ${isWin ? 'text-[#3fb950]' : 'text-[#da3633]'}`}>
                    {isWin ? '+' : ''}{trade.netPnl.toFixed(2)}
                </div>
            </div>
        </div>
    );
};

// --- PnL Chart Component ---

const PnLChart = ({ history }: { history: TradeHistoryItem[] }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    // Prepare Data: Cumulative PnL over time
    const chartData = useMemo(() => {
        // Sort by exit time ascending
        const sorted = [...history].sort((a, b) => a.exitTime - b.exitTime);
        let runningPnL = 0;
        return sorted.map(t => {
            runningPnL += t.netPnl;
            return {
                time: t.exitTime / 1000,
                value: runningPnL
            };
        });
    }, [history]);

    useEffect(() => {
        if (!chartContainerRef.current) return;
        if (chartData.length === 0) return;

        const chart = createChart(chartContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: '#161b22' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            width: chartContainerRef.current.clientWidth,
            height: 200,
            timeScale: { timeVisible: true, borderColor: '#30363d' },
            rightPriceScale: { borderColor: '#30363d' },
        });

        const areaSeries = chart.addAreaSeries({
            lineColor: '#58a6ff',
            topColor: 'rgba(88, 166, 255, 0.4)',
            bottomColor: 'rgba(88, 166, 255, 0.0)',
            lineWidth: 2,
        });

        // @ts-ignore - Lightweight charts types can be finicky with specific data structures
        areaSeries.setData(chartData);
        chart.timeScale().fitContent();

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [chartData]);

    if (history.length === 0) return <div className="h-[200px] flex items-center justify-center text-[#8b949e] text-xs">No Data for Chart</div>;

    return <div ref={chartContainerRef} className="w-full h-[200px]" />;
};

// --- Main Modal ---

const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, history, onClear }) => {
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'TRADES' | 'DAILY'>('DAILY');

  // --- Analytics Logic ---
  const stats = useMemo(() => {
    const totalTrades = history.length;
    const netPnl = history.reduce((acc, t) => acc + t.netPnl, 0);
    const grossPnl = history.reduce((acc, t) => acc + t.grossPnl, 0);
    const totalFees = history.reduce((acc, t) => acc + t.entryFee + t.exitFee, 0);
    
    const wins = history.filter(t => t.netPnl > 0);
    const losses = history.filter(t => t.netPnl <= 0);
    
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
    
    const totalWinAmt = wins.reduce((acc, t) => acc + t.netPnl, 0);
    const totalLossAmt = Math.abs(losses.reduce((acc, t) => acc + t.netPnl, 0));
    
    const avgWin = wins.length > 0 ? totalWinAmt / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLossAmt / losses.length : 0;
    const profitFactor = totalLossAmt > 0 ? totalWinAmt / totalLossAmt : totalWinAmt > 0 ? 999 : 0;

    // Best/Worst
    const sortedByPnl = [...history].sort((a, b) => b.netPnl - a.netPnl);
    const bestTrade = sortedByPnl.length > 0 ? sortedByPnl[0] : null;
    const worstTrade = sortedByPnl.length > 0 ? sortedByPnl[sortedByPnl.length - 1] : null;

    // Asset Distribution
    const assetStats: Record<string, { count: number, pnl: number }> = {};
    history.forEach(t => {
        if (!assetStats[t.symbol]) assetStats[t.symbol] = { count: 0, pnl: 0 };
        assetStats[t.symbol].count += 1;
        assetStats[t.symbol].pnl += t.netPnl;
    });

    const assetList = Object.entries(assetStats)
        .sort((a, b) => b[1].count - a[1].count) // Sort by most traded
        .slice(0, 5); // Top 5

    return {
        totalTrades,
        netPnl,
        totalFees,
        winRate,
        profitFactor,
        avgWin,
        avgLoss,
        bestTrade,
        worstTrade,
        assetList
    };
  }, [history]);

  // --- Daily Log Logic ---
  const dailyStats = useMemo(() => {
    const groups: Record<string, { date: number, count: number, wins: number, pnl: number, volume: number }> = {};
    
    history.forEach(t => {
        const d = new Date(t.exitTime);
        d.setHours(0,0,0,0);
        const dayKey = d.getTime();
        
        if (!groups[dayKey]) {
            groups[dayKey] = { date: dayKey, count: 0, wins: 0, pnl: 0, volume: 0 };
        }
        
        groups[dayKey].count += 1;
        groups[dayKey].pnl += t.netPnl;
        groups[dayKey].volume += (t.size * t.exitPrice); // Approximate volume
        if (t.netPnl > 0) groups[dayKey].wins += 1;
    });

    return Object.values(groups).sort((a, b) => b.date - a.date);
  }, [history]);

  // Filtered List for Trades Table
  const filteredHistory = useMemo(() => {
      return history.filter(h => h.symbol.toLowerCase().includes(filter.toLowerCase())).reverse();
  }, [history, filter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200 overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#161b22] px-6 py-4 border-b border-[#30363d] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-[#58a6ff]/10 rounded-lg">
                <svg className="w-5 h-5 text-[#58a6ff]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
             </div>
             <div>
                 <h2 className="text-white font-bold text-lg tracking-wide">TRADING JOURNAL</h2>
                 <p className="text-[#8b949e] text-xs">Performance Analytics & History</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#30363d] rounded-full text-[#8b949e] hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-6 space-y-6">
                
                {/* 1. Summary Cards Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard 
                        label="Net PnL" 
                        value={`${stats.netPnl >= 0 ? '+' : ''}$${stats.netPnl.toFixed(2)}`} 
                        subValue={`Fees Paid: -$${stats.totalFees.toFixed(2)}`}
                        colorClass={stats.netPnl >= 0 ? 'text-[#3fb950]' : 'text-[#da3633]'}
                    />
                    <StatCard 
                        label="Win Rate" 
                        value={`${stats.winRate.toFixed(1)}%`}
                        subValue={`${stats.totalTrades} Total Trades`}
                        colorClass={stats.winRate >= 50 ? 'text-[#3fb950]' : 'text-[#d29922]'}
                    />
                    <StatCard 
                        label="Profit Factor" 
                        value={stats.profitFactor.toFixed(2)}
                        subValue="Gross Win / Gross Loss"
                        colorClass="text-[#58a6ff]"
                    />
                    <StatCard 
                        label="Avg Risk : Reward" 
                        value={`1 : ${(stats.avgWin / (stats.avgLoss || 1)).toFixed(2)}`}
                        subValue={`Avg Win: $${stats.avgWin.toFixed(0)} / Loss: $${stats.avgLoss.toFixed(0)}`}
                        colorClass="text-white"
                    />
                </div>

                {/* 2. Charts & Distribution Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[250px] lg:h-[280px]">
                    {/* Main Equity Curve */}
                    <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex flex-col">
                        <div className="text-xs font-bold text-[#8b949e] mb-2 uppercase">Cumulative PnL Curve</div>
                        <div className="flex-1 w-full min-h-0">
                            <PnLChart history={history} />
                        </div>
                    </div>
                    
                    {/* Top Assets */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex flex-col overflow-hidden">
                        <div className="text-xs font-bold text-[#8b949e] mb-4 uppercase">Top Traded Assets</div>
                        <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2">
                            {stats.assetList.length === 0 ? (
                                <div className="text-center text-[#8b949e] text-xs mt-10">No trades yet</div>
                            ) : (
                                stats.assetList.map(([symbol, data]) => (
                                    <div key={symbol} className="flex flex-col gap-1">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-white">{symbol}</span>
                                            <span className="text-[#8b949e]">{data.count} Trades</span>
                                        </div>
                                        {/* Simple Bar */}
                                        <div className="w-full h-1.5 bg-[#0d1117] rounded-full overflow-hidden flex">
                                            <div 
                                                className={`h-full ${data.pnl >= 0 ? 'bg-[#3fb950]' : 'bg-[#da3633]'}`} 
                                                style={{ width: `${Math.min(100, Math.max(10, (Math.abs(data.pnl) / (Math.abs(stats.netPnl) || 1)) * 100))}%` }}
                                            ></div>
                                        </div>
                                        <div className={`text-[10px] text-right ${data.pnl >= 0 ? 'text-[#3fb950]' : 'text-[#da3633]'}`}>
                                            {data.pnl >= 0 ? '+' : ''}{data.pnl.toFixed(2)} PnL
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* 3. Highlights Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <HighlightCard title="Best Trade" trade={stats.bestTrade} />
                    <HighlightCard title="Worst Loss" trade={stats.worstTrade} />
                </div>

                {/* 4. Log Section with Tabs */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg flex flex-col min-h-[350px]">
                    <div className="p-4 border-b border-[#30363d] flex flex-wrap gap-2 justify-between items-center">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setViewMode('DAILY')}
                                className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                                    viewMode === 'DAILY' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'
                                }`}
                            >
                                DAILY SUMMARY
                            </button>
                            <button
                                onClick={() => setViewMode('TRADES')}
                                className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                                    viewMode === 'TRADES' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'
                                }`}
                            >
                                DETAILED TRADES
                            </button>
                        </div>
                        
                        <div className="flex gap-2">
                             {viewMode === 'TRADES' && (
                                 <input 
                                    type="text"
                                    placeholder="Filter Symbol..."
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                    className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-[#58a6ff] w-32 md:w-48"
                                 />
                             )}
                             {history.length > 0 && (
                                <button 
                                    onClick={onClear}
                                    className="px-3 py-1 bg-[#da3633]/10 border border-[#da3633]/50 text-[#da3633] text-xs font-bold rounded hover:bg-[#da3633]/20 transition-colors"
                                >
                                    CLEAR HISTORY
                                </button>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        {viewMode === 'TRADES' ? (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#161b22] sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Date</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Symbol</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Side</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Entry</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Exit</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Fees</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">Net PnL</th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-[#30363d]">
                                {filteredHistory.length === 0 ? (
                                    <tr>
                                    <td colSpan={7} className="p-8 text-center text-[#8b949e] text-xs">No trades found.</td>
                                    </tr>
                                ) : (
                                    filteredHistory.map((trade) => (
                                    <tr key={trade.id} className="hover:bg-[#21262d] transition-colors font-mono text-xs group">
                                        <td className="p-3 text-[#c9d1d9] whitespace-nowrap">
                                        {new Date(trade.exitTime).toLocaleString([], {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                                        </td>
                                        <td className="p-3 font-bold text-white">{trade.symbol}</td>
                                        <td className="p-3">
                                            <span className="bg-[#3fb950]/10 text-[#3fb950] px-1.5 py-0.5 rounded text-[10px] font-bold border border-[#3fb950]/20">LONG</span>
                                        </td>
                                        <td className="p-3 text-[#c9d1d9]">{trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(2)}</td>
                                        <td className="p-3 text-[#c9d1d9]">{trade.exitPrice < 1 ? trade.exitPrice.toFixed(6) : trade.exitPrice.toFixed(2)}</td>
                                        <td className="p-3 text-[#d29922]">
                                        ${(trade.entryFee + trade.exitFee).toFixed(2)}
                                        </td>
                                        <td className={`p-3 text-right font-bold ${trade.netPnl >= 0 ? 'text-[#3fb950]' : 'text-[#da3633]'}`}>
                                        {trade.netPnl >= 0 ? '+' : ''}{trade.netPnl.toFixed(2)}
                                        </td>
                                    </tr>
                                    ))
                                )}
                                </tbody>
                            </table>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#161b22] sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Date</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Trades</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Win Rate</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Volume (Est)</th>
                                    <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">Daily PnL</th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-[#30363d]">
                                {dailyStats.length === 0 ? (
                                    <tr>
                                    <td colSpan={5} className="p-8 text-center text-[#8b949e] text-xs">No history available.</td>
                                    </tr>
                                ) : (
                                    dailyStats.map((day) => (
                                    <tr key={day.date} className="hover:bg-[#21262d] transition-colors font-mono text-xs">
                                        <td className="p-3 font-bold text-white">
                                            {new Date(day.date).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                                        </td>
                                        <td className="p-3 text-[#c9d1d9]">
                                            {day.count} <span className="text-[#8b949e] text-[10px]">({day.wins} W / {day.count - day.wins} L)</span>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-1.5 bg-[#0d1117] rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-[#3fb950]" 
                                                        style={{ width: `${(day.wins / day.count) * 100}%` }}
                                                    ></div>
                                                </div>
                                                <span className={day.wins / day.count >= 0.5 ? 'text-[#3fb950]' : 'text-[#d29922]'}>
                                                    {((day.wins / day.count) * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-3 text-[#c9d1d9]">
                                            ${day.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </td>
                                        <td className={`p-3 text-right font-bold ${day.pnl >= 0 ? 'text-[#3fb950]' : 'text-[#da3633]'}`}>
                                            {day.pnl >= 0 ? '+' : ''}{day.pnl.toFixed(2)}
                                        </td>
                                    </tr>
                                    ))
                                )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

            </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
