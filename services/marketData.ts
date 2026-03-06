import { Candle } from '../types';

type Subscriber = (candle: Candle) => void;

class MarketDataService {
  private ws: WebSocket | null = null;
  private subscribers: Subscriber[] = [];
  private currentSymbol: string | null = null;
  private currentInterval: string | null = null;
  private reconnectTimer: number | null = null;

  public subscribe(callback: Subscriber) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }

  public connect(symbol: string, interval: string) {
    // If symbol and interval match, and connection is open, do nothing
    if (this.currentSymbol === symbol && this.currentInterval === interval && this.ws?.readyState === WebSocket.OPEN) return;
    
    this.disconnect();
    this.currentSymbol = symbol;
    this.currentInterval = interval;
    
    this.initWebSocket(symbol, interval);
  }

  private initWebSocket(symbol: string, interval: string) {
    // Connect to Binance Spot WebSocket with dynamic interval
    this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);

    this.ws.onopen = () => {
      console.log(`Connected to Binance WS for ${symbol} ${interval}`);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.e === 'kline') {
          const k = message.k;
          const candle: Candle = {
            time: k.t / 1000,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          };
          this.notifySubscribers(candle);
        }
      } catch (e) {
        console.error("WS Message Error", e);
      }
    };

    this.ws.onclose = () => {
      // Simple reconnect logic if needed, but for now we just log
      console.log("Binance WS Closed");
    };

    this.ws.onerror = (err) => {
      console.error("Binance WS Error", err);
    };
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Reset trackers
    this.currentSymbol = null;
    this.currentInterval = null;
  }

  private notifySubscribers(candle: Candle) {
    this.subscribers.forEach(sub => sub(candle));
  }
}

export const marketService = new MarketDataService();