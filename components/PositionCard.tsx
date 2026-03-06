
import React from 'react';
import { Position } from '../types';
import { TRADING_FEE_RATE } from '../constants';

interface PositionCardProps {
  position: Position;
  currentPrice: number;
  onClose: () => void;
  onSelectSymbol?: (symbol: string) => void;
  isEditingSL: boolean;
  onToggleEditSL: () => void;
}

const PositionCard: React.FC<PositionCardProps> = ({ 
  position, 
  currentPrice, 
  onClose, 
  onSelectSymbol,
  isEditingSL,
  onToggleEditSL
}) => {
  // Gross PnL (Price movement only)
  const grossPnl = (currentPrice - position.entryPrice) * position.size;
  
  // Calculate Estimated Exit Fee (0.1% of current value)
  const estimatedExitFee = (currentPrice * position.size) * TRADING_FEE_RATE;
  
  // Net PnL = Gross PnL - Entry Fee (already paid) - Estimated Exit Fee (will pay)
  const netPnl = grossPnl - position.entryFee - estimatedExitFee;
  
  // Net ROI % = (Net PnL / Initial Investment) * 100
  const initialInvestment = position.size * position.entryPrice;
  const netRoiPercent = (netPnl / initialInvestment) * 100;

  const isProfit = netPnl >= 0;

  return (
    <div className="w-full h-14 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4 animate-in slide-in-from-top-full duration-300 shadow-lg relative z-30">
        
        {/* Symbol Info */}
        <div className="flex items-center gap-3">
            <button 
              onClick={() => onSelectSymbol?.(position.symbol)}
              className="font-bold text-white text-sm tracking-wide hover:text-[#58a6ff] transition-colors text-left"
              title="Go to Chart"
            >
              {position.symbol}
            </button>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d]">
                <span className={`w-1.5 h-1.5 rounded-full ${isProfit ? 'bg-[#3fb950]' : 'bg-[#f85149]'} animate-pulse`}></span>
                <span className="text-[10px] text-[#8b949e] font-mono font-bold">LONG</span>
            </div>
        </div>

        {/* PnL Center */}
        <div className="flex flex-col items-end md:items-center">
            <div className={`font-mono font-bold text-sm ${isProfit ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                {isProfit ? '+' : ''}{netPnl.toFixed(2)}
            </div>
            <div className={`font-mono text-[10px] ${isProfit ? 'text-[#3fb950]/80' : 'text-[#f85149]/80'}`}>
                {isProfit ? '+' : ''}{netRoiPercent.toFixed(2)}%
            </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
            <button 
                onClick={onToggleEditSL}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-all border ${
                  isEditingSL 
                    ? 'bg-[#d29922]/20 border-[#d29922] text-[#d29922] animate-pulse'
                    : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white hover:border-[#8b949e]'
                }`}
            >
                {isEditingSL ? 'CANCEL SL' : 'MOVE SL'}
            </button>
            
            <button 
                onClick={onClose}
                className="px-4 py-1.5 bg-[#da3633]/10 hover:bg-[#da3633]/20 border border-[#da3633]/30 hover:border-[#da3633] text-[#da3633] text-xs font-bold rounded transition-all tracking-wider"
            >
                CLOSE
            </button>
        </div>
    </div>
  );
};

export default PositionCard;
