
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { marketService } from './services/marketData';
import { 
  getBinanceCandles, 
  getSymbolRules, 
  executeMarketBuy, 
  placeOCOOrder, 
  closePosition, 
  cancelAndReplaceOCO, 
  cancelAllOpenOrders,
  getAccountData,
  getAllOpenOrders,
  getLastTrade
} from './services/binance';
import { hasSavedKeys, getDecryptedKeys } from './services/crypto';
import { Candle, Position, TradeConfig, AccountState, MarketTicker, TradeHistoryItem, Trendline } from './types';
import { INITIAL_BALANCE, TRADING_FEE_RATE, MIN_NOTIONAL, MIN_SL_NOTIONAL } from './constants';
import TVChart from './components/TVChart';
import ControlPanel from './components/ControlPanel';
import PositionCard from './components/PositionCard';
import MarketList from './components/MarketList';
import BinanceModal from './components/BinanceModal';
import HistoryModal from './components/HistoryModal';
import PortfolioModal from './components/PortfolioModal';
import TradeLogger, { LogEntry } from './components/TradeLogger';

const TIME_FRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const HISTORY_STORAGE_KEY = 'sniper_trade_history';
const CONFIG_STORAGE_KEY = 'sniper_trade_config';
const TRENDLINES_STORAGE_KEY = 'sniper_trendlines';

// Helper to determine decimals from stepSize or tickSize
const getDecimals = (val: number): number => {
  const s = val.toString();
  if (s.includes('e-')) {
    return parseInt(s.split('e-')[1], 10);
  }
  return s.includes('.') ? s.split('.')[1].length : 0;
};

// Helper to safely floor to a specific precision to avoid floating point noise
const formatToPrecision = (value: number, step: number): number => {
  const decimals = getDecimals(step);
  const factor = Math.pow(10, decimals);
  const truncated = Math.floor(value * factor) / factor;
  return parseFloat(truncated.toFixed(decimals));
};

const App: React.FC = () => {
  // Market Data State
  const [activeSymbol, setActiveSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [currentCandle, setCurrentCandle] = useState<Candle | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [marketList, setMarketList] = useState<MarketTicker[]>([]);
  
  // Market List Refresh Trigger
  const [marketRefreshTrigger, setMarketRefreshTrigger] = useState(0);

  // Background Price State for Persistent PnL
  const [backgroundPrice, setBackgroundPrice] = useState<number | null>(null);

  // Active Symbol Ref to avoid dependency cycles in sync logic
  const activeSymbolRef = useRef(activeSymbol);
  useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

  // User State
  const [account, setAccount] = useState<AccountState>(() => {
    try {
      const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      return {
        balance: INITIAL_BALANCE,
        equity: INITIAL_BALANCE,
        positions: [],
        history: savedHistory ? JSON.parse(savedHistory) : [],
        assets: []
      };
    } catch (e) {
      console.error("Failed to load history", e);
      return {
        balance: INITIAL_BALANCE,
        equity: INITIAL_BALANCE,
        positions: [],
        history: [],
        assets: []
      };
    }
  });

  // Trendlines State
  const [trendlines, setTrendlines] = useState<Trendline[]>(() => {
    try {
      const saved = localStorage.getItem(TRENDLINES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  // Persist Trendlines
  useEffect(() => {
    localStorage.setItem(TRENDLINES_STORAGE_KEY, JSON.stringify(trendlines));
  }, [trendlines]);

  const handleAddTrendline = (p1: { time: number, price: number }, p2: { time: number, price: number }) => {
    const newLine: Trendline = {
      id: Date.now().toString(),
      symbol: activeSymbol,
      interval: interval,
      p1,
      p2
    };
    setTrendlines(prev => [...prev, newLine]);
  };

  const handleDeleteTrendline = (id: string) => {
    setTrendlines(prev => prev.filter(t => t.id !== id));
  };

  // Keep a ref of account for silent polling access to previous state
  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);

  // Persist History
  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(account.history));
  }, [account.history]);

  // UI / Logic State
  const [tradeConfig, setTradeConfig] = useState<TradeConfig>(() => {
    try {
      const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
      return savedConfig ? JSON.parse(savedConfig) : {
        riskPercentage: 1.0,
        riskRewardRatio: 2.0,
      };
    } catch (e) {
      return {
        riskPercentage: 1.0,
        riskRewardRatio: 2.0,
      };
    }
  });

  // Persist Config
  useEffect(() => {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(tradeConfig));
  }, [tradeConfig]);

  // Binance Connection State
  const [isBinanceModalOpen, setIsBinanceModalOpen] = useState(false);
  const [hasBinanceKeys, setHasBinanceKeys] = useState(false);
  const [apiKeys, setApiKeys] = useState<{apiKey: string, apiSecret: string} | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal States
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);

  // Draft Trade State
  const [slPrice, setSlPrice] = useState<number | null>(null);
  const [tpPrice, setTpPrice] = useState<number | null>(null);
  const [calculatedSize, setCalculatedSize] = useState<number | null>(null);
  const [potentialLabels, setPotentialLabels] = useState<{loss: string, profit: string}>({ loss: '', profit: '' });

  // SL Editing Mode State
  const [isEditingSL, setIsEditingSL] = useState(false);

  // Execution Logging
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logTimeoutRef = useRef<number | null>(null);

  // Mobile Layout State
  const [isMobile, setIsMobile] = useState(false);
  const [showMarkets, setShowMarkets] = useState(true);
  const [showTrade, setShowTrade] = useState(true);

  // Identify the Single Open Position (if any)
  const openPosition = account.positions.length > 0 ? account.positions[0] : null;

  // Responsive Check
  useEffect(() => {
    const handleResize = () => {
      // Treat tablet (< 1024px) as mobile to allow drawers
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setShowMarkets(false);
        setShowTrade(false);
      } else {
        setShowMarkets(true);
        setShowTrade(true);
      }
    };
    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleMarkets = () => {
    setShowMarkets(!showMarkets);
    if (isMobile && !showMarkets) setShowTrade(false); // Close other panel on mobile
  };

  const toggleTrade = () => {
    setShowTrade(!showTrade);
    if (isMobile && !showTrade) setShowMarkets(false); // Close other panel on mobile
  };

  const closePanels = () => {
    if (isMobile) {
      setShowMarkets(false);
      setShowTrade(false);
    }
  };

  // Check for saved keys on mount
  useEffect(() => {
    setHasBinanceKeys(hasSavedKeys());
  }, []);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(),
      timestamp: Date.now(),
      message,
      type
    }]);
    setShowLogs(true);

    if (logTimeoutRef.current) {
      window.clearTimeout(logTimeoutRef.current);
    }
    
    logTimeoutRef.current = window.setTimeout(() => {
      setShowLogs(false);
      logTimeoutRef.current = null;
    }, 5000);
  }, []);
  
  const clearLogs = () => {
    setLogs([]);
  };

  // --- Core Sync Logic ---
  const syncBinanceState = useCallback(async (keys: {apiKey: string, apiSecret: string}, silent = false) => {
    if (!keys) return;
    if (!silent) setIsSyncing(true);
    if (!silent) addLog("Syncing with Binance...", 'info');

    try {
      // 1. Get Comprehensive Account Data (Assets, Free USDT, Total Est Equity)
      const accountData = await getAccountData(keys.apiKey, keys.apiSecret);
      
      // 2. Get All Open Orders
      const orders = await getAllOpenOrders(keys.apiKey, keys.apiSecret);
      
      // 3. Reconstruct Positions
      // Group orders by Symbol
      const ordersBySymbol: Record<string, any[]> = {};
      orders.forEach((o: any) => {
        if (!ordersBySymbol[o.symbol]) ordersBySymbol[o.symbol] = [];
        ordersBySymbol[o.symbol].push(o);
      });

      const reconstructedPositions: Position[] = [];

      for (const symbol of Object.keys(ordersBySymbol)) {
        const symOrders = ordersBySymbol[symbol];
        
        // Check for OCO-like structure or standalone SL
        // Binance SL is usually STOP_LOSS_LIMIT or STOP_LOSS
        // TP is LIMIT_MAKER or TAKE_PROFIT_LIMIT
        
        const slOrder = symOrders.find((o: any) => o.type === 'STOP_LOSS_LIMIT' || o.type === 'STOP_LOSS');
        const tpOrder = symOrders.find((o: any) => o.type === 'LIMIT_MAKER' || o.type === 'TAKE_PROFIT_LIMIT');

        if (slOrder) {
          // We found an active protection order. We likely have a position.
          const baseAsset = symbol.replace('USDT', ''); // Assumption: USDT pairs
          const assetBalance = accountData.assets.find((a: any) => a.asset === baseAsset);
          
          if (assetBalance && assetBalance.total > 0) {
             // We have the asset and the orders.
             // Try to find entry price from last trade
             let entryPrice = parseFloat(slOrder.price); // Fallback
             try {
                const lastTrade = await getLastTrade(symbol, keys.apiKey, keys.apiSecret);
                if (lastTrade && lastTrade.isBuyer) {
                   entryPrice = parseFloat(lastTrade.price);
                }
             } catch (e) { console.warn("Could not fetch last trade for entry price"); }

             const pos: Position = {
               id: slOrder.orderId.toString(), // Use Order ID as Position ID
               symbol: symbol,
               entryPrice: entryPrice,
               size: assetBalance.total, // Use total held balance as position size
               stopLoss: parseFloat(slOrder.stopPrice || slOrder.price),
               takeProfit: tpOrder ? parseFloat(tpOrder.price) : 0,
               direction: 'LONG', // Spot is always Long
               timestamp: slOrder.time,
               entryFee: 0 // Cannot easily calculate history fee without deep dive
             };
             reconstructedPositions.push(pos);
             if (!silent) addLog(`Found active position: ${symbol} (${pos.size})`, 'success');
          }
        }
      }

      // --- CLOSURE DETECTION LOGIC ---
      // Compare previous known positions with reconstructed positions
      const previousPositions = accountRef.current.positions;
      // We identify closures by symbol, assuming 1 active position per symbol
      const closedPositions = previousPositions.filter(prevPos => 
        !reconstructedPositions.find(newPos => newPos.symbol === prevPos.symbol)
      );

      const newHistory: TradeHistoryItem[] = [];

      for (const closedPos of closedPositions) {
          // Only log if it wasn't a manual clearing (we can check if it really sold on Binance)
          try {
             // Fetch last trade to get exit price
             const lastTrade: any = await getLastTrade(closedPos.symbol, keys.apiKey, keys.apiSecret);
             
             // Logic: If the last trade is a SELL and it happened AFTER our entry, it's a valid exit.
             // If we just cancelled orders manually but didn't sell, isBuyer would likely be true (from entry) or time would be old.
             const lastTradeTime = lastTrade ? Number(lastTrade.time) : 0;
             if (lastTrade && !lastTrade.isBuyer && lastTradeTime > Number(closedPos.timestamp)) { 
                 const exitPrice = parseFloat(lastTrade.price);
                 // const exitQty = parseFloat(lastTrade.qty);
                 const exitTime = lastTrade.time;
                 const exitFee = parseFloat(lastTrade.commission) * (lastTrade.commissionAsset === 'USDT' ? 1 : exitPrice); // Rough approx
                 
                 const grossPnl = (exitPrice - closedPos.entryPrice) * closedPos.size;
                 const netPnl = grossPnl - (closedPos.entryFee + exitFee);

                 newHistory.push({
                     id: Date.now().toString(),
                     symbol: closedPos.symbol,
                     entryPrice: closedPos.entryPrice,
                     exitPrice: exitPrice,
                     size: closedPos.size,
                     entryTime: closedPos.timestamp,
                     exitTime: exitTime,
                     entryFee: closedPos.entryFee,
                     exitFee: exitFee,
                     grossPnl: grossPnl,
                     netPnl: netPnl,
                     isWin: netPnl > 0,
                     direction: 'LONG'
                 });
                 addLog(`Order Filled: ${closedPos.symbol} Closed. PnL: ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}`, netPnl >= 0 ? 'success' : 'error');
             }
          } catch (e) {
             console.error("Failed to fetch closure details", e);
          }
      }

      setAccount(prev => {
        return {
          ...prev,
          balance: accountData.usdtFree,
          equity: accountData.totalEquity, // Accurately calculated total value from API
          assets: accountData.assets,
          positions: reconstructedPositions,
          history: [...prev.history, ...newHistory]
        };
      });

      if (!silent && reconstructedPositions.length > 0 && reconstructedPositions[0].symbol !== activeSymbolRef.current) {
         addLog(`Note: Active position found on ${reconstructedPositions[0].symbol}`, 'info');
      }

    } catch (e: any) {
      if (!silent) addLog(`Sync Error: ${e.message}`, 'error');
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, [addLog]); // Removed activeSymbol dependency

  // Handle Keys & Initial Sync
  useEffect(() => {
    if (apiKeys) {
      syncBinanceState(apiKeys);
    }
  }, [apiKeys, syncBinanceState]);

  // Handle Online/Offline & Reconnection
  useEffect(() => {
    const handleOnline = () => {
       addLog("Network connection restored.", 'success');
       if (apiKeys) {
          syncBinanceState(apiKeys);
       }
    };

    const handleOffline = () => {
       addLog("Network connection lost. Trading disabled.", 'error');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [apiKeys, syncBinanceState, addLog]);

  // Polling Interval: Syncs state every 5s to detect filled orders / SL / TP
  useEffect(() => {
    if (!apiKeys) return;
    
    // Initial sync (silent)
    syncBinanceState(apiKeys, true); 
    
    const timer: number = window.setInterval(() => {
      syncBinanceState(apiKeys, true);
    }, 5000); 

    return () => window.clearInterval(timer);
  }, [apiKeys, syncBinanceState]);

  // Initial Data Load & Subscription
  useEffect(() => {
    let ignore = false;

    const loadMarket = async () => {
      try {
        const history = await getBinanceCandles(activeSymbol, interval);
        if (ignore) return;
        setCandles(history);
        if (history.length > 0) {
          const last = history[history.length - 1];
          setCurrentPrice(last.close);
          setCurrentCandle(last);
        }
        if (!ignore) {
          marketService.connect(activeSymbol, interval);
        }
      } catch (err) {
        console.error("Failed to load market data", err);
      }
    };

    loadMarket();

    const unsubscribe = marketService.subscribe((candle) => {
      setCurrentCandle(candle);
      setCurrentPrice(candle.close);
    });

    return () => {
      ignore = true;
      unsubscribe();
      marketService.disconnect();
    };
  }, [activeSymbol, interval]);

  // --- Persistent Price Tracking for Background Position ---
  useEffect(() => {
    if (!openPosition) {
      setBackgroundPrice(null);
      return;
    }

    if (openPosition.symbol === activeSymbol) {
      // If we are looking at the chart, we don't need a separate socket
      setBackgroundPrice(null);
      return;
    }

    // If we are looking at a DIFFERENT chart, subscribe to the position's price
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${openPosition.symbol.toLowerCase()}@miniTicker`);
    
    ws.onopen = () => {
      console.log(`Tracking background price for ${openPosition.symbol}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setBackgroundPrice(parseFloat(data.c));
      } catch (e) {
        console.error("Background ticker error", e);
      }
    };

    return () => {
      ws.close();
    };
  }, [openPosition?.symbol, activeSymbol]);


  const handleSymbolChange = (ticker: MarketTicker) => {
    if (ticker.symbol === activeSymbol) return;
    setActiveSymbol(ticker.symbol);
    setCandles([]);
    setCurrentCandle(null);
    setCurrentPrice(0);
    setSlPrice(null);
    setTpPrice(null);
    setCalculatedSize(null);
    setIsEditingSL(false); // Reset editing mode
    if (isMobile) closePanels();
  };
  
  const handleCycleMarket = (direction: 'next' | 'prev') => {
    if (marketList.length === 0) return;
    const currentIndex = marketList.findIndex(m => m.symbol === activeSymbol);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === 'next') {
        nextIndex = (currentIndex + 1) % marketList.length;
    } else {
        nextIndex = (currentIndex - 1 + marketList.length) % marketList.length;
    }
    
    handleSymbolChange(marketList[nextIndex]);
  };

  const handleIntervalChange = (newInterval: string) => {
    if (newInterval === interval) return;
    setInterval(newInterval);
    setCandles([]);
  };

  // Recalculate Logic
  useEffect(() => {
    // Only allow drafting if we don't have an active position (single trade mode)
    if (openPosition) {
       // If we have a position, clear any drafts
       setCalculatedSize(null);
       setTpPrice(null);
       return;
    }

    if (slPrice && currentPrice > slPrice) {
      const riskAmount = account.equity * (tradeConfig.riskPercentage / 100);
      const priceDist = currentPrice - slPrice;
      
      if (priceDist <= 0) {
        setCalculatedSize(null);
        return;
      }

      let size = riskAmount / priceDist;
      
      // Limit to 95% of available balance to leave room for fees and price fluctuation
      const maxPossibleSize = (account.balance * 0.95) / currentPrice;
      if (size > maxPossibleSize) {
        size = maxPossibleSize;
      }
      
      const rewardDist = priceDist * tradeConfig.riskRewardRatio;
      const target = currentPrice + rewardDist;

      setCalculatedSize(size);
      setTpPrice(target);

      const actualRisk = size * priceDist;
      const actualReward = size * rewardDist;

      setPotentialLabels({
        loss: `-$${actualRisk.toFixed(2)}`,
        profit: `+$${actualReward.toFixed(2)}`
      });

    } else if (slPrice && currentPrice <= slPrice) {
      setCalculatedSize(null);
      setTpPrice(null);
      setPotentialLabels({ loss: 'Invalid', profit: '' });
    } else {
      if (!slPrice) {
         setCalculatedSize(null);
         setTpPrice(null);
      }
    }
  }, [slPrice, currentPrice, tradeConfig, account.equity, account.balance, activeSymbol, openPosition]);

  const handleConfigChange = (key: keyof TradeConfig, value: number) => {
    setTradeConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSlSelect = (price: number) => {
    if (account.positions.length > 0) return;
    if (price >= currentPrice) return;
    setSlPrice(price);
    if (isMobile) setShowTrade(true); // Open trade panel when SL is set to see details
  };

  // --- TRADING EXECUTION ---

  const executeTrade = async () => {
    if (!calculatedSize || !slPrice || !tpPrice) return;
    setIsEditingSL(false);

    // Validate Minimum Order Value (Entry)
    const notional = calculatedSize * currentPrice;
    if (notional < MIN_NOTIONAL) {
       addLog(`Order rejected: Value $${notional.toFixed(2)} is below minimum $${MIN_NOTIONAL}.`, 'error');
       return;
    }

    // Validate Minimum Order Value (Exit/SL)
    const slNotional = calculatedSize * slPrice;
    if (slNotional < MIN_SL_NOTIONAL) {
       addLog(`Order rejected: SL Value $${slNotional.toFixed(2)} is below minimum $${MIN_SL_NOTIONAL}.`, 'error');
       return;
    }

    const estimatedEntryFee = (calculatedSize * currentPrice) * TRADING_FEE_RATE;

    if (hasBinanceKeys && !apiKeys) {
      setIsBinanceModalOpen(true);
      return;
    }

    if (hasBinanceKeys && apiKeys) {
      setLogs([]); 
      addLog(`Initializing SPOT Buy for ${activeSymbol}...`);

      try {
        addLog(`Fetching Exchange Rules...`);
        const rules = await getSymbolRules(activeSymbol);
        
        const finalQty = formatToPrecision(calculatedSize, rules.stepSize);
        const finalTp = formatToPrecision(tpPrice, rules.tickSize);
        const finalSl = formatToPrecision(slPrice, rules.tickSize);
        // Important: stopLimitPrice must also be formatted. We use a 0.5% buffer for execution.
        let finalSlLimit = formatToPrecision(finalSl * 0.995, rules.tickSize);
        
        // Safety: stopLimitPrice MUST be less than stopPrice for a SELL OCO
        if (finalSlLimit >= finalSl) {
           finalSlLimit = formatToPrecision(finalSl - rules.tickSize, rules.tickSize);
        }

        // --- PRE-VALIDATION: Check Percent Price Filters ---
        // This prevents entering a trade if the SL/TP would be rejected immediately.
        const minAllowedSell = currentPrice * rules.multiplierDown;
        const maxAllowedSell = currentPrice * rules.multiplierUp;

        if (finalSlLimit < minAllowedSell) {
            addLog(`Trade Blocked: SL Limit (${finalSlLimit}) is below allowed minimum (${minAllowedSell.toFixed(4)}). Market is too far away.`, 'error');
            return;
        }

        if (finalTp > maxAllowedSell) {
             // Often exchanges don't cap sell limit as strictly as buy limit, but if defined, we respect it.
             addLog(`Trade Blocked: TP (${finalTp}) is above allowed maximum (${maxAllowedSell.toFixed(4)}).`, 'error');
             return;
        }


        if (finalQty < rules.minQty) {
           addLog(`Size ${finalQty} below min ${rules.minQty}`, 'error');
           return;
        }

        const notional = finalQty * currentPrice;
        if (notional < rules.minNotional) {
            addLog(`Order value $${notional.toFixed(2)} too low (Min $${rules.minNotional})`, 'error');
            return;
        }
        
        addLog(`Adjusted Size: ${finalQty} | SL: ${finalSl} | TP: ${finalTp}`);
        addLog("Sending MARKET BUY order...");
        
        const buyRes = await executeMarketBuy(activeSymbol, finalQty, apiKeys.apiKey, apiKeys.apiSecret);
        addLog(`BUY FILLED. Avg Price: ${currentPrice} (approx)`, 'success');
        
        const filledQty = parseFloat(buyRes.executedQty);
        const fillPrice = parseFloat(buyRes.cummulativeQuoteQty) / filledQty || currentPrice;
        const actualEntryFee = (filledQty * fillPrice) * TRADING_FEE_RATE;

        addLog("Placing OCO (SL/TP) Protection...");
        await placeOCOOrder(activeSymbol, filledQty, finalTp, finalSl, finalSlLimit, apiKeys.apiKey, apiKeys.apiSecret);
        addLog("OCO Orders Placed Successfully", 'success');

        const newPosition: Position = {
          id: Date.now().toString(),
          symbol: activeSymbol,
          entryPrice: fillPrice, 
          size: filledQty,
          stopLoss: finalSl,
          takeProfit: finalTp,
          direction: 'LONG',
          timestamp: Date.now(),
          entryFee: actualEntryFee
        };

        setAccount(prev => ({ ...prev, positions: [newPosition] }));
        setSlPrice(null);
        setTpPrice(null);
        setCalculatedSize(null);
        
        // Full Sync to ensure state is perfect
        // Wait small delay to let local state settle before triggering a "check"
        setTimeout(() => syncBinanceState(apiKeys, true), 500);
        closePanels();

      } catch (e: any) {
        addLog(e.message || "Trade Failed", 'error');
      }

    } else {
      const newPosition: Position = {
        id: Date.now().toString(),
        symbol: activeSymbol,
        entryPrice: currentPrice,
        size: calculatedSize,
        stopLoss: slPrice,
        takeProfit: tpPrice,
        direction: 'LONG',
        timestamp: Date.now(),
        entryFee: estimatedEntryFee
      };
      setAccount(prev => ({ ...prev, positions: [newPosition] }));
      setSlPrice(null);
      setTpPrice(null);
      setCalculatedSize(null);
      closePanels();
    }
  };

  const handleClosePosition = async (pos: Position, price: number) => {
    setIsEditingSL(false);
    const exitValue = pos.size * price;
    const entryValue = pos.size * pos.entryPrice;
    const grossPnl = exitValue - entryValue;
    const exitFee = exitValue * TRADING_FEE_RATE;
    const netPnl = grossPnl - (pos.entryFee + exitFee);

    if (hasBinanceKeys && apiKeys) {
      setLogs([]); 
      addLog(`Initiating Market Exit for ${pos.symbol}...`);
      
      try {
        // Fetch rules first to ensure valid quantity for SELL
        const rules = await getSymbolRules(pos.symbol);
        const validSize = formatToPrecision(pos.size, rules.stepSize);
        
        if (validSize !== pos.size) {
            addLog(`Adjusting exit quantity: ${pos.size} -> ${validSize}`, 'info');
        }

        addLog("Cancelling OCO/Open Orders...");
        await closePosition(pos.symbol, validSize, apiKeys.apiKey, apiKeys.apiSecret);
        addLog("Position Closed & Orders Cancelled", 'success');

        const historyItem: TradeHistoryItem = {
           id: Date.now().toString(),
           symbol: pos.symbol,
           entryPrice: pos.entryPrice,
           exitPrice: price,
           size: validSize, // Log the actual size sold
           entryTime: pos.timestamp,
           exitTime: Date.now(),
           entryFee: pos.entryFee,
           exitFee: exitFee,
           grossPnl: grossPnl,
           netPnl: netPnl,
           isWin: netPnl > 0,
           direction: 'LONG'
        };

        setAccount(prev => ({
          balance: prev.balance + netPnl, 
          equity: prev.balance + netPnl,
          positions: [],
          history: [...prev.history, historyItem],
          assets: prev.assets // Keep existing assets until refresh
        }));
        
        // Delay sync to allow ref to update (prevent double history)
        setTimeout(() => syncBinanceState(apiKeys, true), 1000);

      } catch (e: any) {
        // Handle Insufficient Balance scenario specifically
        if (e.message.includes('-2010') || e.message.toLowerCase().includes('insufficient balance')) {
           const confirmForce = window.confirm(
             `Close Failed: Insufficient Balance.\n\nFunds might be locked in open orders.\n\nDo you want to FORCE CANCEL all open orders for ${pos.symbol} to free up funds?`
           );
           
           if (confirmForce) {
              addLog("Attempting to FORCE CANCEL all orders...", 'info');
              try {
                await cancelAllOpenOrders(pos.symbol, apiKeys.apiKey, apiKeys.apiSecret);
                addLog("All open orders cancelled. Please try closing the position again.", 'success');
              } catch (cancelError: any) {
                addLog(`Force Cancel Failed: ${cancelError.message}`, 'error');
              }
           }
        } else {
           addLog(e.message || "Exit Failed", 'error');
        }
      }

    } else {
      const historyItem: TradeHistoryItem = {
           id: Date.now().toString(),
           symbol: pos.symbol,
           entryPrice: pos.entryPrice,
           exitPrice: price,
           size: pos.size,
           entryTime: pos.timestamp,
           exitTime: Date.now(),
           entryFee: pos.entryFee,
           exitFee: exitFee,
           grossPnl: grossPnl,
           netPnl: netPnl,
           isWin: netPnl > 0,
           direction: 'LONG'
      };

      setAccount(prev => ({
        balance: prev.balance + netPnl,
        equity: prev.balance + netPnl,
        positions: [],
        history: [...prev.history, historyItem],
        assets: prev.assets
      }));
    }
  };

  const handleUpdatePosition = async (type: 'SL' | 'TP', newPrice: number) => {
    const activePos = account.positions.find(p => p.symbol === activeSymbol);
    if (!activePos) return;

    // Risk Management: Only allow SL to be moved UP
    if (type === 'SL' && newPrice < activePos.stopLoss) {
        addLog('Risk Management: Stop Loss can only be moved HIGHER.', 'error');
        setAccount(prev => ({...prev})); // Force re-render to reset chart view
        return;
    }

    if (hasBinanceKeys && apiKeys) {
        setLogs([]);
        addLog(`Modifying ${type} to ${newPrice.toFixed(2)}...`);

        try {
            const rules = await getSymbolRules(activeSymbol);
            const adjustedPrice = formatToPrecision(newPrice, rules.tickSize);

            const newSl = type === 'SL' ? adjustedPrice : activePos.stopLoss;
            const newTp = type === 'TP' ? adjustedPrice : activePos.takeProfit;

            let finalSlLimit = formatToPrecision(newSl * 0.995, rules.tickSize);
            if (finalSlLimit >= newSl) {
              finalSlLimit = formatToPrecision(newSl - rules.tickSize, rules.tickSize);
            }

            if (newSl >= currentPrice || newTp <= currentPrice) {
                addLog(`Invalid ${type} level relative to current price.`, 'error');
                setAccount(prev => ({...prev})); 
                return;
            }

            addLog("Cancelling old OCO and replacing...");
            await cancelAndReplaceOCO(activeSymbol, activePos.size, newTp, newSl, finalSlLimit, apiKeys.apiKey, apiKeys.apiSecret);
            addLog("Order Updated Successfully", 'success');

            setAccount(prev => ({
                ...prev,
                positions: prev.positions.map(p => 
                    p.id === activePos.id 
                    ? { ...p, stopLoss: newSl, takeProfit: newTp }
                    : p
                )
            }));

        } catch (e: any) {
            addLog(e.message || "Modification Failed", 'error');
            setAccount(prev => ({...prev}));
        }
    } else {
        setAccount(prev => ({
            ...prev,
            positions: prev.positions.map(p => 
                p.id === activePos.id 
                ? { ...p, stopLoss: type === 'SL' ? newPrice : p.stopLoss, takeProfit: type === 'TP' ? newPrice : p.takeProfit }
                : p
            )
        }));
    }
  };

  const handleKeysDecrypted = (keys: {apiKey: string, apiSecret: string}) => {
    setApiKeys(keys);
  };

  const handleClearHistory = () => {
    if(window.confirm('Are you sure you want to clear the trade history?')) {
      setAccount(prev => ({...prev, history: []}));
    }
  };

  // Determine if lines should be shown on the current chart
  const activePositionOnChart = openPosition?.symbol === activeSymbol ? openPosition : null;
  // Determine the price to calculate PnL for the card
  const livePositionPrice = (openPosition?.symbol === activeSymbol) ? currentPrice : (backgroundPrice || openPosition?.entryPrice || 0);

  // Wrapper for updating from chart (resets editing mode)
  const handleChartSLUpdate = (type: 'SL' | 'TP', price: number) => {
    handleUpdatePosition(type, price);
    setIsEditingSL(false);
  };

  // --- Calculate Daily Stats ---
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Midnight today
  
  const dailyTrades = account.history.filter(trade => trade.exitTime >= today.getTime());
  const dailyPnL = dailyTrades.reduce((acc, trade) => acc + trade.netPnl, 0);
  const dailyCount = dailyTrades.length;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0d1117] text-[#e6edf3] font-sans overflow-hidden">
      
      <header className="min-h-[3rem] md:h-12 h-auto border-b border-[#30363d] flex flex-wrap md:flex-nowrap items-center justify-between px-2 py-2 md:py-0 md:px-4 bg-[#161b22] z-20 shrink-0 gap-y-2 md:gap-2">
        
        {/* Left: Logo */}
        <div className="flex items-center gap-2 shrink-0 order-1">
          <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full animate-pulse shadow-[0_0_8px_rgba(35,134,54,0.6)] ${apiKeys ? 'bg-[#238636]' : 'bg-[#8b949e]'}`}></div>
          <span className="font-bold tracking-wide text-xs md:text-sm font-mono hidden sm:inline">SNIPER<span className="text-[#58a6ff]">.TERM</span></span>
          <span className="font-bold tracking-wide text-xs font-mono sm:hidden">Sniper-Terminal</span>
        </div>

        {/* Right: Buttons */}
        <div className="flex gap-2 shrink-0 order-2 md:order-3">
            <button 
                onClick={() => setIsHistoryOpen(true)}
                className="px-2 md:px-3 py-1.5 rounded border border-[#30363d] bg-[#21262d] text-[#8b949e] text-[10px] md:text-xs font-bold hover:text-white hover:border-[#8b949e] transition-all flex items-center gap-1 md:gap-2"
            >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden md:inline">HISTORY</span>
            </button>
            <button 
                onClick={() => {
                  if (showLogs) {
                    setShowLogs(false);
                    // Clear timer if manually closing
                    if (logTimeoutRef.current) {
                      window.clearTimeout(logTimeoutRef.current);
                      logTimeoutRef.current = null;
                    }
                  } else {
                    setShowLogs(true);
                  }
                }}
                className={`px-2 md:px-3 py-1.5 rounded border transition-all text-[10px] md:text-xs font-bold flex items-center gap-2 ${
                    showLogs 
                    ? 'bg-[#1f242c] border-[#8b949e] text-white' 
                    : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white hover:border-[#8b949e]'
                }`}
            >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="hidden md:inline">CONSOLE</span>
            </button>
            <button 
            onClick={() => setIsBinanceModalOpen(true)}
            className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 rounded border transition-all text-[10px] md:text-xs font-bold ${
                hasBinanceKeys 
                ? (apiKeys ? 'bg-[#FCD535]/20 border-[#FCD535] text-[#FCD535]' : 'bg-[#FCD535]/10 border-[#FCD535]/50 text-[#FCD535] hover:bg-[#FCD535]/20')
                : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white hover:border-[#8b949e]'
            }`}
            >
            <svg className="w-3 h-3 md:w-4 md:h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0106l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6355-2.7175-2.7155 7.353-7.3288z"></path>
            </svg>
            <span className="hidden md:inline">{apiKeys ? 'ACTIVE' : 'CONNECT'}</span>
            <span className="md:hidden">{apiKeys ? 'ON' : 'OFF'}</span>
            </button>
            
            {/* Mobile/Tablet Trade Toggle */}
            <button 
              onClick={toggleTrade}
              className={`lg:hidden px-3 py-1.5 rounded border font-bold text-xs transition-all flex items-center justify-center ${showTrade ? 'bg-[#58a6ff] border-[#58a6ff] text-white' : 'bg-[#21262d] border-[#30363d] text-[#8b949e]'}`}
            >
               TRADE
            </button>
        </div>

        {/* Center: Stats (Merged for Mobile/Desktop) */}
        <div className="flex items-center justify-around md:justify-center gap-2 md:gap-6 w-full md:w-auto md:flex-1 order-3 md:order-2 border-t border-[#30363d] md:border-t-0 pt-1.5 md:pt-0 mt-1 md:mt-0">
            {/* Trade Count */}
            <div className="flex flex-row md:flex-col items-baseline md:items-end gap-1 md:gap-0 shrink-0">
                <span className="text-[#8b949e] text-[10px] md:text-[9px] uppercase tracking-tighter font-bold md:font-normal">
                    TRADE:
                </span>
                <span className="font-mono font-bold text-xs md:text-lg leading-none text-white">
                    {dailyCount}
                </span>
            </div>

            <div className="w-px h-3 md:h-8 bg-[#30363d] hidden md:block"></div>

            {/* Daily PnL */}
            <div className="flex flex-row md:flex-col items-baseline md:items-end gap-1 md:gap-0 shrink-0">
                <span className="text-[#8b949e] text-[10px] md:text-[9px] uppercase tracking-tighter font-bold md:font-normal">
                    PNL:
                </span>
                <span className={`font-mono font-bold text-xs md:text-lg leading-none ${dailyPnL >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                    {dailyPnL >= 0 ? '+' : ''}{isMobile ? Math.round(dailyPnL) : dailyPnL.toFixed(2)}
                </span>
            </div>

            <div className="w-px h-3 md:h-8 bg-[#30363d] hidden md:block"></div>

            {/* Available Balance */}
             <div className="flex flex-row md:flex-col items-baseline md:items-end gap-1 md:gap-0 shrink-0">
                <span className="text-[#8b949e] text-[10px] md:text-[9px] uppercase tracking-tighter font-bold md:font-normal">
                    <span className="md:hidden">Avl:</span>
                    <span className="hidden md:inline">AVAILABLE</span>
                </span>
                <span className="font-mono font-bold text-xs md:text-lg leading-none text-white">
                    ${isMobile ? Math.round(account.balance).toLocaleString() : account.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
            </div>

            <div className="w-px h-3 md:h-8 bg-[#30363d] hidden md:block"></div>

            {/* Equity */}
            <div className="flex items-center gap-2 shrink-0">
                <div 
                   onClick={() => setIsPortfolioOpen(true)}
                   className="flex flex-row md:flex-col items-baseline md:items-end gap-1 md:gap-0 cursor-pointer hover:bg-[#30363d]/50 rounded px-2 transition-colors"
                   title="View Portfolio"
                >
                    <span className="text-[#8b949e] text-[10px] md:text-[9px] uppercase tracking-tighter font-bold md:font-normal">
                        <span className="md:hidden">Tot:</span>
                        <span className="hidden md:inline">TOTAL</span>
                    </span>
                    <span className={`font-mono font-bold text-xs md:text-lg leading-none ${account.equity >= account.balance ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                        ${isMobile ? Math.round(account.equity).toLocaleString() : account.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                </div>
                 {apiKeys && (
                     <button 
                      onClick={() => {
                        syncBinanceState(apiKeys, false);
                        setMarketRefreshTrigger(prev => prev + 1);
                      }}
                      disabled={isSyncing}
                      className={`p-1 rounded hover:bg-[#30363d] transition-all ${isSyncing ? 'text-[#58a6ff]' : 'text-[#8b949e]'}`}
                      title="Refresh Balance & Markets"
                     >
                       <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                       </svg>
                     </button>
                   )}
            </div>
        </div>
        
      </header>
      
      {/* Position Card Banner - Moved to top under header */}
      {openPosition && livePositionPrice > 0 && (
        <div className="shrink-0 z-30 w-full relative">
          <PositionCard 
            position={openPosition} 
            currentPrice={livePositionPrice}
            onClose={() => handleClosePosition(openPosition, livePositionPrice)}
            onSelectSymbol={(symbol) => {
              if (symbol === activeSymbol) return;
              setActiveSymbol(symbol);
              setCandles([]);
              setCurrentCandle(null);
              setCurrentPrice(0);
              setSlPrice(null);
              setTpPrice(null);
              setCalculatedSize(null);
              setIsEditingSL(false);
              if (isMobile) closePanels();
            }}
            isEditingSL={isEditingSL}
            onToggleEditSL={() => setIsEditingSL(!isEditingSL)}
          />
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Market List Panel (Drawer on Mobile/Tablet, Sidebar on Desktop) */}
        <div className={`
          absolute inset-y-0 left-0 z-40 bg-[#0d1117] transition-transform duration-300 transform w-[85%] max-w-[300px] lg:w-auto lg:relative lg:translate-x-0 lg:z-0
          ${showMarkets ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}>
           <MarketList 
            onSelect={handleSymbolChange} 
            activeSymbol={activeSymbol} 
            refreshTrigger={marketRefreshTrigger}
            onListUpdate={setMarketList}
           />
        </div>

        {/* Mobile Backdrop */}
        {isMobile && (showMarkets || showTrade) && (
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
            onClick={closePanels}
          ></div>
        )}

        <main className="flex-1 relative flex flex-col min-w-0">
          
          <div className="flex-1 relative w-full overflow-hidden">
            {/* Mobile/Tablet Market Navigation Buttons (Up/Down) */}
            <div className="lg:hidden absolute bottom-20 right-4 z-30 flex flex-col gap-2">
               <button 
                 onClick={() => handleCycleMarket('prev')}
                 className="flex items-center justify-center w-8 h-8 bg-[#161b22]/90 border border-[#30363d] rounded-full text-[#8b949e] shadow-lg backdrop-blur hover:text-white hover:border-[#58a6ff] transition-all"
                 title="Previous Coin"
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                 </svg>
               </button>
               <button 
                 onClick={() => handleCycleMarket('next')}
                 className="flex items-center justify-center w-8 h-8 bg-[#161b22]/90 border border-[#30363d] rounded-full text-[#8b949e] shadow-lg backdrop-blur hover:text-white hover:border-[#58a6ff] transition-all"
                 title="Next Coin"
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                 </svg>
               </button>
            </div>

            {/* Mobile/Tablet Market Opener (Moved to bottom-right to align with arrows) */}
            <button 
              onClick={toggleMarkets}
              className="lg:hidden absolute bottom-8 right-4 z-30 flex items-center justify-center w-10 h-10 bg-[#161b22] border border-[#30363d] rounded-full text-[#8b949e] shadow-lg backdrop-blur hover:text-white hover:border-[#58a6ff] transition-all"
              title="Open Markets"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Desktop Time Frame Bar (Floating) */}
            <div className="hidden lg:flex absolute z-20 bg-[#161b22] border border-[#30363d] rounded p-0.5 shadow-lg backdrop-blur bg-opacity-90 top-3 right-4">
              {TIME_FRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => handleIntervalChange(tf)}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    interval === tf 
                      ? 'bg-[#238636] text-white shadow-sm' 
                      : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]'
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            {candles.length > 0 ? (
              <TVChart 
                key={`${activeSymbol}-${interval}`}
                data={candles}
                symbol={activeSymbol}
                lastCandle={currentCandle}
                currentPrice={currentPrice}
                entryPrice={currentPrice}
                onPriceSelect={handleSlSelect}
                onUpdateOrder={handleChartSLUpdate}
                slPreviewPrice={slPrice}
                tpPreviewPrice={tpPrice}
                activePosition={activePositionOnChart ? {
                  entry: activePositionOnChart.entryPrice,
                  sl: activePositionOnChart.stopLoss,
                  tp: activePositionOnChart.takeProfit
                } : null}
                potentialLossLabel={slPrice ? potentialLabels.loss : null}
                potentialProfitLabel={tpPrice ? potentialLabels.profit : null}
                isEditingSL={isEditingSL}
                trendlines={trendlines.filter(t => t.symbol === activeSymbol && t.interval === interval)}
                onAddTrendline={handleAddTrendline}
                onDeleteTrendline={handleDeleteTrendline}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#8b949e]">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#58a6ff] border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs">Loading {activeSymbol} {interval}...</span>
                </div>
              </div>
            )}
            
            {!openPosition && !slPrice && (
              <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-[#161b22] border border-[#58a6ff] text-[#58a6ff] px-4 py-2 rounded shadow-lg text-sm font-bold pointer-events-none z-30 opacity-70 whitespace-nowrap">
                CLICK CHART TO SET STOP LOSS
              </div>
            )}

            {openPosition && isEditingSL && (
              <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-[#d29922] text-white px-4 py-2 rounded shadow-lg text-sm font-bold pointer-events-none z-30 animate-pulse whitespace-nowrap">
                TAP CHART TO SET NEW STOP LOSS
              </div>
            )}
          </div>

          {/* Mobile Time Frame Bar (Separate at Bottom) */}
          <div className="lg:hidden shrink-0 h-12 bg-[#161b22] border-t border-[#30363d] flex items-center justify-center gap-2 overflow-x-auto px-2 z-30">
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => handleIntervalChange(tf)}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-all whitespace-nowrap ${
                  interval === tf 
                    ? 'bg-[#238636] text-white shadow-sm' 
                    : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <TradeLogger 
            logs={logs} 
            isVisible={showLogs} 
            onClose={() => setShowLogs(false)} 
            onClear={clearLogs}
          />
        </main>

        {/* Control Panel (Drawer on Mobile/Tablet, Sidebar on Desktop) */}
        <div className={`
           absolute inset-y-0 right-0 z-40 bg-[#0d1117] transition-transform duration-300 transform w-[85%] max-w-[320px] lg:w-auto lg:relative lg:translate-x-0 lg:z-0
           ${showTrade ? 'translate-x-0 shadow-2xl' : 'translate-x-full lg:translate-x-0'}
        `}>
          <ControlPanel 
            config={tradeConfig}
            onConfigChange={handleConfigChange}
            onConfirmTrade={executeTrade}
            onCancel={() => {
              setSlPrice(null);
              if (isMobile) closePanels();
            }}
            calculatedSize={calculatedSize}
            currentPrice={currentPrice}
            slDistance={slPrice ? currentPrice - slPrice : null}
            canExecute={!!calculatedSize}
            equity={account.equity}
            symbol={activeSymbol}
            isDrafting={!!slPrice}
          />
        </div>

      </div>

      <BinanceModal 
        isOpen={isBinanceModalOpen} 
        onClose={() => setIsBinanceModalOpen(false)}
        isConnected={hasBinanceKeys}
        onConnectionChanged={setHasBinanceKeys}
        onKeysDecrypted={(keys) => handleKeysDecrypted(keys)}
      />

      <HistoryModal 
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={account.history}
        onClear={handleClearHistory}
      />

      <PortfolioModal
        isOpen={isPortfolioOpen}
        onClose={() => setIsPortfolioOpen(false)}
        assets={account.assets}
        totalEquity={account.equity}
      />
    </div>
  );
};

export default App;
