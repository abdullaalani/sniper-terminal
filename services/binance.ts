
import { MarketTicker, Candle, Asset } from '../types';
import CryptoJS from 'crypto-js';

const API_URL = 'https://api.binance.com';

// --- Public Data ---

export const getBinanceMarkets = async (): Promise<MarketTicker[]> => {
  try {
    const [tickerRes, infoRes] = await Promise.all([
      fetch(`${API_URL}/api/v3/ticker/24hr`),
      fetch(`${API_URL}/api/v3/exchangeInfo?permissions=SPOT`)
    ]);

    if (!tickerRes.ok) throw new Error('Failed to fetch ticker data');
    if (!infoRes.ok) throw new Error('Failed to fetch exchange info');

    const tickers = await tickerRes.json();
    const info = await infoRes.json();

    const activeSymbols = new Set(
      info.symbols
        .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s: any) => s.symbol)
    );

    return tickers
      .filter((t: any) => activeSymbols.has(t.symbol))
      .map((t: any) => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        changePercent: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume)
      }))
      .sort((a: MarketTicker, b: MarketTicker) => b.changePercent - a.changePercent);
  } catch (error) {
    console.error("Binance API Error:", error);
    return [];
  }
};

export const getBinanceCandles = async (symbol: string, interval: string = '15m'): Promise<Candle[]> => {
  try {
    const res = await fetch(`${API_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`);
    if (!res.ok) throw new Error('Failed to fetch candles');
    const data = await res.json();
    
    return data.map((d: any) => ({
      time: d[0] / 1000,
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
    }));
  } catch (error) {
    console.error("Binance Candle Error:", error);
    return [];
  }
};

// --- Authenticated Trading ---

interface SymbolRules {
  stepSize: number;
  tickSize: number;
  minQty: number;
  minNotional: number;
  multiplierDown: number; // Min allowed price multiplier (e.g. 0.2 for 20% of current price)
  multiplierUp: number;   // Max allowed price multiplier (e.g. 5.0 for 500% of current price)
}

export interface AccountData {
  assets: Asset[];
  usdtFree: number;
  totalEquity: number;
}

// Helper to sign query string
const sign = (queryString: string, apiSecret: string) => {
  return CryptoJS.HmacSHA256(queryString, apiSecret).toString();
};

// Helper for authenticated fetch
const binanceRequest = async (endpoint: string, method: string, params: Record<string, any>, apiKey: string, apiSecret: string) => {
  // Subtract 1000ms to prevent "timestamp ahead of server" errors if local clock is slightly fast
  const timestamp = Date.now() - 1000;
  
  // Add recvWindow to allow for network latency and clock skew (max 60000)
  const queryParams = new URLSearchParams({ 
    ...params, 
    recvWindow: '60000',
    timestamp: timestamp.toString() 
  });
  
  const signature = sign(queryParams.toString(), apiSecret);
  queryParams.append('signature', signature);

  const response = await fetch(`${API_URL}${endpoint}?${queryParams.toString()}`, {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
    }
  });

  const data = await response.json();
  if (!response.ok) {
    const code = data.code;
    let msg = data.msg || 'Binance API Request Failed';
    
    if (code === -2010) msg = "Insufficient Balance or Verification Failed";
    if (code === -1013 && msg.includes("MIN_NOTIONAL")) msg = "Order value too low (Min ~$5.00)";
    if (code === -1013 && msg.includes("LOT_SIZE")) msg = "Quantity invalid (Check step size)";
    if (code === -1013 && msg.includes("PERCENT_PRICE")) msg = "Price is too far from market price (Filter Failure)";
    if (code === -1021) msg = "Timestamp for this request was outside of the recvWindow.";

    throw new Error(`[${code}] ${msg}`);
  }
  return data;
};

// 1. Get Precision Rules & Filters
export const getSymbolRules = async (symbol: string): Promise<SymbolRules> => {
  const res = await fetch(`${API_URL}/api/v3/exchangeInfo?symbol=${symbol}`);
  
  if (!res.ok) throw new Error('Failed to fetch symbol rules');

  const data = await res.json();
  if (!data.symbols || data.symbols.length === 0) {
      throw new Error(`Symbol ${symbol} not found.`);
  }
  const s = data.symbols[0];
  
  const lotSize = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
  const priceFilter = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
  const notional = s.filters.find((f: any) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
  
  // Price Band Filters
  const percentPrice = s.filters.find((f: any) => f.filterType === 'PERCENT_PRICE');
  const percentPriceBySide = s.filters.find((f: any) => f.filterType === 'PERCENT_PRICE_BY_SIDE');

  if (!lotSize || !priceFilter) {
      throw new Error(`Filters missing for ${symbol}`);
  }

  // Determine multipliers for SELL side (Ask)
  // Default loose values: 0.2 (80% drop allowed) to 5.0 (500% gain allowed)
  let multiplierDown = 0.2; 
  let multiplierUp = 5.0; 

  if (percentPriceBySide) {
    // Specific Bid/Ask limits
    multiplierDown = parseFloat(percentPriceBySide.askMultiplierDown);
    multiplierUp = parseFloat(percentPriceBySide.askMultiplierUp);
  } else if (percentPrice) {
    // Generic limits
    multiplierDown = parseFloat(percentPrice.multiplierDown);
    multiplierUp = parseFloat(percentPrice.multiplierUp);
  }

  return {
    stepSize: parseFloat(lotSize.stepSize),
    minQty: parseFloat(lotSize.minQty),
    tickSize: parseFloat(priceFilter.tickSize),
    minNotional: notional ? parseFloat(notional.minNotional || notional.minQty) : 5.0,
    multiplierDown,
    multiplierUp
  };
};

// 2. Market Buy
export const executeMarketBuy = async (symbol: string, quantity: number, apiKey: string, apiSecret: string) => {
  return await binanceRequest('/api/v3/order', 'POST', {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quantity: quantity
  }, apiKey, apiSecret);
};

// 3. Place OCO (SL & TP)
export const placeOCOOrder = async (
  symbol: string, 
  quantity: number, 
  tpPrice: number, 
  slPrice: number,
  slLimitPrice: number, // Explicitly passed and formatted
  apiKey: string, 
  apiSecret: string
) => {
  return await binanceRequest('/api/v3/order/oco', 'POST', {
    symbol,
    side: 'SELL',
    quantity,
    price: tpPrice,        
    stopPrice: slPrice,    
    stopLimitPrice: slLimitPrice, 
    stopLimitTimeInForce: 'GTC'
  }, apiKey, apiSecret);
};

// 4. Cancel & Replace OCO (For Editing SL/TP)
export const cancelAndReplaceOCO = async (
  symbol: string,
  quantity: number,
  newTpPrice: number,
  newSlPrice: number,
  newSlLimitPrice: number, // Explicitly passed and formatted
  apiKey: string,
  apiSecret: string
) => {
  try {
    await binanceRequest('/api/v3/openOrders', 'DELETE', { symbol }, apiKey, apiSecret);
  } catch (e) {
    console.warn("No open orders to cancel before replacement");
  }
  return await placeOCOOrder(symbol, quantity, newTpPrice, newSlPrice, newSlLimitPrice, apiKey, apiSecret);
};

// 5. Market Sell (Exit)
export const closePosition = async (symbol: string, quantity: number, apiKey: string, apiSecret: string) => {
  try {
     await binanceRequest('/api/v3/openOrders', 'DELETE', { symbol }, apiKey, apiSecret);
  } catch (e) {
    console.warn("No open orders to cancel or failed", e);
  }

  return await binanceRequest('/api/v3/order', 'POST', {
    symbol,
    side: 'SELL',
    type: 'MARKET',
    quantity
  }, apiKey, apiSecret);
};

// 6. Get Full Account Data (Balances + Estimated Equity)
export const getAccountData = async (apiKey: string, apiSecret: string): Promise<AccountData> => {
  // Fetch Account Balances
  const accountRes = await binanceRequest('/api/v3/account', 'GET', {}, apiKey, apiSecret);
  
  // Filter for relevant assets (non-zero)
  const rawBalances = accountRes.balances
    .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

  // Fetch Current Prices for all assets to calculate equity
  const pricesRes = await fetch(`${API_URL}/api/v3/ticker/price`);
  const prices = await pricesRes.json();
  // Explicitly type the Map to ensure proper arithmetic types later
  const priceMap = new Map<string, number>(prices.map((p: any) => [p.symbol, parseFloat(p.price)]));

  let usdtFree = 0;
  let totalEquity = 0;
  
  const processedAssets: Asset[] = [];

  for (const b of rawBalances) {
    const free = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const total = free + locked;
    
    let value = 0;

    if (b.asset === 'USDT') {
       usdtFree = free;
       value = total;
    } else {
       // Find standard pair
       const pair = `${b.asset}USDT`;
       if (priceMap.has(pair)) {
          value = total * (priceMap.get(pair) || 0);
       } else if (['BUSD', 'USDC', 'FDUSD', 'TUSD'].includes(b.asset)) {
          // Approximate 1:1 for stablecoins if direct pair missing/low liq
          value = total;
       }
    }
    
    totalEquity += value;
    
    processedAssets.push({
      asset: b.asset,
      free,
      locked,
      total,
      usdtValue: value
    });
  }

  return {
    assets: processedAssets,
    usdtFree,
    totalEquity
  };
};

// 7. Get All Open Orders (For Position Reconstruction)
export const getAllOpenOrders = async (apiKey: string, apiSecret: string) => {
  return await binanceRequest('/api/v3/openOrders', 'GET', {}, apiKey, apiSecret);
};

// 8. Get Last Trade (To infer entry price)
export const getLastTrade = async (symbol: string, apiKey: string, apiSecret: string) => {
  const trades = await binanceRequest('/api/v3/myTrades', 'GET', { symbol, limit: 1 }, apiKey, apiSecret);
  return trades.length > 0 ? trades[0] : null;
};

// 9. Cancel All Open Orders
export const cancelAllOpenOrders = async (symbol: string, apiKey: string, apiSecret: string) => {
  return await binanceRequest('/api/v3/openOrders', 'DELETE', { symbol }, apiKey, apiSecret);
};
