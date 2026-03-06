
import React from 'react';
import { TradeConfig } from '../types';
import { MIN_NOTIONAL, MIN_SL_NOTIONAL } from '../constants';

interface ControlPanelProps {
  config: TradeConfig;
  onConfigChange: (key: keyof TradeConfig, value: number) => void;
  onConfirmTrade: () => void;
  onCancel: () => void;
  calculatedSize: number | null;
  currentPrice: number;
  slDistance: number | null;
  canExecute: boolean;
  equity: number;
  symbol: string;
  isDrafting: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  config,
  onConfigChange,
  onConfirmTrade,
  onCancel,
  calculatedSize,
  currentPrice,
  slDistance,
  canExecute,
  equity,
  symbol,
  isDrafting
}) => {
  const riskAmount = equity * (config.riskPercentage / 100);
  const positionValue = calculatedSize ? calculatedSize * currentPrice : 0;
  
  // Calculate SL Price and Value
  const slPrice = (calculatedSize && slDistance) ? currentPrice - slDistance : 0;
  const slValue = calculatedSize ? calculatedSize * slPrice : 0;

  // Validation
  const isEntryTooSmall = positionValue < MIN_NOTIONAL;
  const isSlTooSmall = slValue < MIN_SL_NOTIONAL;
  
  const isExecutable = canExecute && !isEntryTooSmall && !isSlTooSmall;

  return (
    <div className="w-full md:w-64 h-full border-l border-[#30363d] bg-[#0d1117] flex flex-col z-10">
      
      {/* Header */}
      <div className="p-4 border-b border-[#30363d]">
        <h2 className="text-sm font-bold tracking-wider text-[#8b949e]">SPOT ORDER ENTRY</h2>
        <div className="text-xl font-bold mt-1 text-white">{symbol}</div>
        <div className="text-2xl font-mono mt-1 text-[#58a6ff]">
            {currentPrice < 1 ? currentPrice.toFixed(6) : currentPrice.toFixed(2)}
        </div>
      </div>

      {/* Settings */}
      <div className="p-4 space-y-6 flex-1 overflow-y-auto">
        
        {/* Risk Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#8b949e] uppercase">Risk Per Trade (%)</label>
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              step="0.1"
              value={config.riskPercentage}
              onChange={(e) => onConfigChange('riskPercentage', parseFloat(e.target.value))}
              className="w-full bg-[#161b22] border border-[#30363d] rounded p-2 text-white font-mono focus:border-[#58a6ff] focus:outline-none"
            />
          </div>
          <div className="text-[#8b949e] text-xs font-mono text-right">
             Risk: ${riskAmount.toFixed(2)}
          </div>
        </div>

        {/* RR Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#8b949e] uppercase">Risk : Reward</label>
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              step="0.5"
              value={config.riskRewardRatio}
              onChange={(e) => onConfigChange('riskRewardRatio', parseFloat(e.target.value))}
              className="w-full bg-[#161b22] border border-[#30363d] rounded p-2 text-white font-mono focus:border-[#58a6ff] focus:outline-none"
            />
          </div>
        </div>

        {/* Dynamic Calculation Card */}
        <div className={`mt-6 p-4 rounded bg-[#161b22] border ${isDrafting ? ((isEntryTooSmall || isSlTooSmall) ? 'border-[#da3633] shadow-[0_0_10px_rgba(218,54,51,0.1)]' : 'border-[#58a6ff] shadow-[0_0_10px_rgba(88,166,255,0.1)]') : 'border-[#30363d]'} transition-all`}>
          {calculatedSize && slDistance ? (
            <div className="space-y-4">
               {/* Primary Value */}
              <div>
                <div className="text-xs text-[#8b949e] mb-1">Buy Value (USDT)</div>
                <div className={`text-xl font-mono font-bold ${isEntryTooSmall ? 'text-[#da3633]' : 'text-white'}`}>
                    ${positionValue.toFixed(2)}
                </div>
                
                {isEntryTooSmall && (
                    <div className="text-[10px] text-[#da3633] font-bold mt-1">
                        ⚠️ MIN ENTRY ${MIN_NOTIONAL}
                    </div>
                )}
                 {isSlTooSmall && !isEntryTooSmall && (
                    <div className="text-[10px] text-[#da3633] font-bold mt-1">
                        ⚠️ SL EXIT VALUE ${slValue.toFixed(2)} &lt; ${MIN_SL_NOTIONAL}
                    </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#30363d]">
                <div>
                   <div className="text-[10px] text-[#8b949e]">SIZE</div>
                   <div className="text-white font-mono text-xs font-bold truncate" title={calculatedSize.toString()}>
                      {calculatedSize.toFixed(4)}
                   </div>
                </div>
                <div>
                   <div className="text-[10px] text-[#8b949e]">MODE</div>
                   <div className="text-[#3fb950] font-mono text-xs font-bold">SPOT</div>
                </div>
              </div>

               <div className="flex justify-between text-xs pt-2">
                 <span className="text-[#8b949e]">SL Dist</span>
                 <span className="text-[#da3633] font-mono">{(slDistance / currentPrice * 100).toFixed(2)}%</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-[#8b949e] text-xs py-4">
              {isDrafting ? 
                <span className="animate-pulse text-[#58a6ff]">Adjusting...</span> : 
                'Click Chart to Set Stop Loss'
              }
            </div>
          )}
        </div>

      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-[#30363d] space-y-3">
        {isDrafting ? (
          <div className="flex gap-2">
             <button 
              onClick={onCancel}
              className="flex-1 py-3 bg-[#30363d] hover:bg-[#484f58] text-white font-bold rounded transition-colors text-xs"
            >
              CANCEL
            </button>
            <button 
              onClick={onConfirmTrade}
              disabled={!isExecutable}
              className={`flex-1 py-3 font-bold rounded transition-colors text-xs ${isExecutable ? 'bg-[#238636] hover:bg-[#2ea043] text-white shadow-[0_0_15px_rgba(35,134,54,0.4)]' : 'bg-[#21262d] text-[#484f58] cursor-not-allowed border border-[#30363d]'}`}
            >
              BUY
            </button>
          </div>
        ) : (
          <div className="w-full py-3 bg-[#21262d] text-[#8b949e] text-center text-xs rounded border border-[#30363d] border-dashed">
             Click chart to start setup
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;
