
import React from 'react';
import { Asset } from '../types';

interface PortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  totalEquity: number;
}

const PortfolioModal: React.FC<PortfolioModalProps> = ({ isOpen, onClose, assets, totalEquity }) => {
  if (!isOpen) return null;

  // Sort by USDT value descending, putting small dust at the bottom
  const sortedAssets = [...assets].sort((a, b) => b.usdtValue - a.usdtValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#0d1117] border border-[#30363d] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="bg-[#161b22] px-6 py-4 border-b border-[#30363d] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
             <h2 className="text-white font-bold text-sm tracking-wide">PORTFOLIO</h2>
             <span className="text-xs text-[#8b949e]">Total Est. Value: <span className="text-[#3fb950] font-mono text-sm font-bold">${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
          </div>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Assets Table */}
        <div className="flex-1 overflow-auto custom-scrollbar p-0">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#161b22] sticky top-0 z-10">
              <tr>
                <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d]">Asset</th>
                <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">Total</th>
                <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">Available</th>
                <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">In Order</th>
                <th className="p-3 text-[10px] font-bold text-[#8b949e] uppercase border-b border-[#30363d] text-right">Value (USDT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {sortedAssets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[#8b949e] text-xs">No assets found.</td>
                </tr>
              ) : (
                sortedAssets.map((asset) => (
                  <tr key={asset.asset} className="hover:bg-[#161b22]/50 transition-colors font-mono text-xs">
                    <td className="p-3 font-bold text-white">{asset.asset}</td>
                    <td className="p-3 text-[#c9d1d9] text-right">{asset.total < 0.000001 ? '< 0.000001' : asset.total.toLocaleString()}</td>
                    <td className="p-3 text-[#3fb950] text-right">{asset.free < 0.000001 ? '-' : asset.free.toLocaleString()}</td>
                    <td className="p-3 text-[#d29922] text-right">{asset.locked > 0 ? asset.locked.toLocaleString() : '-'}</td>
                    <td className="p-3 text-right font-bold text-white">
                       {asset.usdtValue < 0.01 ? '< $0.01' : `$${asset.usdtValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-[#30363d] text-[10px] text-[#8b949e] text-center bg-[#161b22]">
           Values are estimated based on current market prices.
        </div>
      </div>
    </div>
  );
};

export default PortfolioModal;
