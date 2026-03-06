
import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import { Candle, Trendline } from '../types';
import { THEME } from '../constants';

const EMA_PERIOD = 50;

function calculateEMA(candles: Candle[], period: number): { time: number; value: number }[] {
  if (candles.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];

  // Seed with SMA of the first `period` candles
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  result.push({ time: candles[period - 1].time, value: ema });

  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
    result.push({ time: candles[i].time, value: ema });
  }
  return result;
}

interface TVChartProps {
  data: Candle[];
  symbol: string;
  lastCandle: Candle | null;
  currentPrice: number;
  entryPrice: number | null; 
  onPriceSelect: (price: number) => void;
  onUpdateOrder?: (type: 'SL' | 'TP', newPrice: number) => void;
  slPreviewPrice: number | null;
  tpPreviewPrice: number | null;
  activePosition: { entry: number; sl: number; tp: number } | null;
  potentialLossLabel?: string | null;
  potentialProfitLabel?: string | null;
  isEditingSL?: boolean;
  
  trendlines?: Trendline[];
  onAddTrendline?: (p1: { time: number; price: number }, p2: { time: number; price: number }) => void;
  onDeleteTrendline?: (id: string) => void;
}

const TVChart: React.FC<TVChartProps> = ({ 
  data, 
  symbol,
  lastCandle, 
  onPriceSelect,
  onUpdateOrder,
  slPreviewPrice,
  tpPreviewPrice,
  activePosition,
  currentPrice,
  potentialLossLabel,
  potentialProfitLabel,
  isEditingSL = false,
  trendlines = [],
  onAddTrendline,
  onDeleteTrendline
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaDataRef = useRef<{ time: number; value: number }[]>([]);
  
  // References for Price Lines
  const slLineRef = useRef<any>(null);
  const tpLineRef = useRef<any>(null);
  const pendingEntryLineRef = useRef<any>(null);

  const activeSlRef = useRef<any>(null);
  const activeTpRef = useRef<any>(null);
  const activeEntryRef = useRef<any>(null);

  // Refs for props to avoid dependency cycles in useEffect
  const activePositionRef = useRef(activePosition);
  const onPriceSelectRef = useRef(onPriceSelect);
  const onUpdateOrderRef = useRef(onUpdateOrder);
  const isEditingSLRef = useRef(isEditingSL);

  // Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawP1, setDrawP1] = useState<{time: number, price: number} | null>(null);
  const [drawP2, setDrawP2] = useState<{time: number, price: number} | null>(null);
  
  // Force update trigger for SVG sync
  const [, setTick] = useState(0);

  useEffect(() => { activePositionRef.current = activePosition; }, [activePosition]);
  useEffect(() => { onPriceSelectRef.current = onPriceSelect; }, [onPriceSelect]);
  useEffect(() => { onUpdateOrderRef.current = onUpdateOrder; }, [onUpdateOrder]);
  useEffect(() => { isEditingSLRef.current = isEditingSL; }, [isEditingSL]);

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.textMuted,
      },
      grid: {
        vertLines: { color: '#1e252e' },
        horzLines: { color: '#1e252e' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      timeScale: {
        borderColor: THEME.border,
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: THEME.border,
      },
    });

    const price = data.length > 0 ? data[data.length - 1].close : currentPrice;
    let precision = 2;
    let minMove = 0.01;
    if (price < 1) { precision = 6; minMove = 0.000001; }
    else if (price < 10) { precision = 4; minMove = 0.0001; }

    const candleSeries = chart.addCandlestickSeries({
      upColor: THEME.chartUp,
      downColor: THEME.chartDown,
      borderVisible: false,
      wickUpColor: THEME.chartUp,
      wickDownColor: THEME.chartDown,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
    });

    candleSeries.setData(data);

    const emaSeries = chart.addLineSeries({
      color: THEME.accent,
      lineWidth: 2,
      title: '50 EMA',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const emaData = calculateEMA(data, EMA_PERIOD);
    emaSeries.setData(emaData);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaSeriesRef.current = emaSeries;
    emaDataRef.current = emaData;

    // --- Events to Sync SVG ---
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        setTick(t => t + 1);
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth, 
          height: chartContainerRef.current.clientHeight 
        });
        setTick(t => t + 1);
      }
    };

    window.addEventListener('resize', handleResize);

    // --- MOUSE INTERACTIONS (SL & Drawing) ---
    const container = chartContainerRef.current;

    const onMouseDown = (e: MouseEvent) => {
        // If drawing active, handle differently
        if (isDrawing) return; // Handled by overlay div

        const isEditing = isEditingSLRef.current;
        const hasPosition = !!activePositionRef.current;

        // If activePosition exists AND we are NOT editing SL, do nothing (read only).
        if (hasPosition && !isEditing) return;

        if (candleSeriesRef.current) {
           const y = e.clientY - container.getBoundingClientRect().top;
           const price = candleSeriesRef.current.coordinateToPrice(y);
           
           if (price) {
             if (hasPosition && isEditing && onUpdateOrderRef.current) {
                // We are editing the SL of an existing position
                onUpdateOrderRef.current('SL', price);
             } else if (!hasPosition && onPriceSelectRef.current) {
                // We are setting the initial SL for a new setup
                onPriceSelectRef.current(price);
             }
           }
        }
    };

    container.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', onMouseDown);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Update Data
  useEffect(() => {
    if (candleSeriesRef.current && lastCandle) {
      candleSeriesRef.current.update(lastCandle);

      // Update EMA with the latest candle
      if (emaSeriesRef.current && emaDataRef.current.length > 0) {
        const multiplier = 2 / (EMA_PERIOD + 1);
        const prevEma = emaDataRef.current[emaDataRef.current.length - 1];
        const lastTime = lastCandle.time;

        if (lastTime === prevEma.time) {
          // Same candle update – recalculate using prior EMA value
          const prior = emaDataRef.current.length > 1
            ? emaDataRef.current[emaDataRef.current.length - 2].value
            : prevEma.value;
          const newValue = (lastCandle.close - prior) * multiplier + prior;
          prevEma.value = newValue;
          emaSeriesRef.current.update(prevEma);
        } else {
          // New candle
          const newValue = (lastCandle.close - prevEma.value) * multiplier + prevEma.value;
          const newPoint = { time: lastTime, value: newValue };
          emaDataRef.current.push(newPoint);
          emaSeriesRef.current.update(newPoint);
        }
      }
    }
  }, [lastCandle]);

  // Handle Preview Lines (Before Execution)
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (slLineRef.current) { candleSeriesRef.current.removePriceLine(slLineRef.current); slLineRef.current = null; }
    if (tpLineRef.current) { candleSeriesRef.current.removePriceLine(tpLineRef.current); tpLineRef.current = null; }
    if (pendingEntryLineRef.current) { candleSeriesRef.current.removePriceLine(pendingEntryLineRef.current); pendingEntryLineRef.current = null; }

    if (!activePosition && slPreviewPrice) {
        pendingEntryLineRef.current = candleSeriesRef.current.createPriceLine({
            price: currentPrice,
            color: THEME.textMuted,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: 'ENTRY',
        });

        slLineRef.current = candleSeriesRef.current.createPriceLine({
            price: slPreviewPrice,
            color: THEME.danger,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `SL ${potentialLossLabel ? `(${potentialLossLabel})` : ''}`,
        });

        if (tpPreviewPrice) {
            tpLineRef.current = candleSeriesRef.current.createPriceLine({
                price: tpPreviewPrice,
                color: THEME.success,
                lineWidth: 2,
                lineStyle: LineStyle.Solid,
                axisLabelVisible: true,
                title: `TP ${potentialProfitLabel ? `(${potentialProfitLabel})` : ''}`,
            });
        }
    }
  }, [slPreviewPrice, tpPreviewPrice, currentPrice, activePosition, potentialLossLabel, potentialProfitLabel]);

  // Handle Active Position Lines (After Execution)
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (activeSlRef.current) { candleSeriesRef.current.removePriceLine(activeSlRef.current); activeSlRef.current = null; }
    if (activeTpRef.current) { candleSeriesRef.current.removePriceLine(activeTpRef.current); activeTpRef.current = null; }
    if (activeEntryRef.current) { candleSeriesRef.current.removePriceLine(activeEntryRef.current); activeEntryRef.current = null; }

    if (activePosition) {
      activeEntryRef.current = candleSeriesRef.current.createPriceLine({
        price: activePosition.entry,
        color: THEME.warning,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'ENTRY',
      });

      activeSlRef.current = candleSeriesRef.current.createPriceLine({
        price: activePosition.sl,
        color: THEME.danger,
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'SL',
      });

      activeTpRef.current = candleSeriesRef.current.createPriceLine({
        price: activePosition.tp,
        color: THEME.success,
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'TP',
      });
    }
  }, [activePosition]);


  // --- DRAWING LOGIC ---
  
  const handleDrawClick = (e: React.MouseEvent) => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = chartRef.current.timeScale().coordinateToTime(x) as number;
    const price = candleSeriesRef.current.coordinateToPrice(y);

    if (!time || !price) return;

    if (!drawP1) {
        setDrawP1({ time, price });
        setDrawP2({ time, price }); // Init preview
    } else {
        // Finish drawing
        if (onAddTrendline) {
            onAddTrendline(drawP1, { time, price });
        }
        setDrawP1(null);
        setDrawP2(null);
        setIsDrawing(false);
    }
  };

  const handleDrawMove = (e: React.MouseEvent) => {
     if (!drawP1 || !chartRef.current || !candleSeriesRef.current) return;
     const rect = chartContainerRef.current?.getBoundingClientRect();
     if (!rect) return;

     const x = e.clientX - rect.left;
     const y = e.clientY - rect.top;

     const time = chartRef.current.timeScale().coordinateToTime(x) as number;
     const price = candleSeriesRef.current.coordinateToPrice(y);

     if (time && price) {
         setDrawP2({ time, price });
     }
  };

  const getCoordinates = (p: { time: number, price: number }) => {
     if (!chartRef.current || !candleSeriesRef.current) return null;
     const x = chartRef.current.timeScale().timeToCoordinate(p.time);
     const y = candleSeriesRef.current.priceToCoordinate(p.price);
     if (x === null || y === null) return null;
     return { x, y };
  };

  // Helper to calculate Ray coordinates extending to the right
  const getRayCoordinates = (p1: { time: number, price: number }, p2: { time: number, price: number }) => {
      const c1 = getCoordinates(p1);
      const c2 = getCoordinates(p2);
      
      if (!c1 || !c2) return null;

      // Logic: P1 is anchor. Ray goes through P2 and extends to width.
      const dx = c2.x - c1.x;
      const dy = c2.y - c1.y;

      // If dots are too close, just return segment
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          return { x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y };
      }

      // Calculate simple projection
      const slope = dy / dx;
      
      // Target X is past the right edge of screen to ensure it covers future candles
      const width = chartContainerRef.current?.clientWidth || 2000;
      const targetX = width + 5000; // Extend far right
      const targetY = c1.y + slope * (targetX - c1.x);

      // We handle the "Left" side clipping automatically by SVG, but we want the ray to always go "forward" relative to P1->P2 direction?
      // User request: "Extend beyond current candles".
      // We will simply project from P1 through P2 to the far right.
      
      // Special case: Vertical line
      if (Math.abs(dx) < 0.1) {
          return { x1: c1.x, y1: -10000, x2: c2.x, y2: 10000 };
      }

      // If user is drawing right-to-left, we still project based on the slope line to the right edge
      // y - y1 = m(x - x1) -> y = y1 + m(x - x1)
      
      return { x1: c1.x, y1: c1.y, x2: targetX, y2: targetY };
  };

  return (
    <div className="w-full h-full relative">
        <div 
            ref={chartContainerRef} 
            className={`w-full h-full relative ${(!activePosition || isEditingSL) ? 'cursor-crosshair' : 'cursor-default'}`} 
        />
        
        {/* Custom Watermark Overlay */}
        <div className="absolute bottom-8 left-4 pointer-events-none z-20 bg-[#0d1117]/80 border border-[#30363d] rounded-lg px-4 py-2 backdrop-blur-sm shadow-lg">
             <span className="text-white text-lg font-bold font-mono tracking-widest select-none">
                {symbol.replace('USDT', ' / USDT')}
            </span>
        </div>
        
        {/* SVG Overlay for Trendlines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden">
             {trendlines.map((t) => {
                 const coords = getRayCoordinates(t.p1, t.p2);
                 if (!coords) return null; 

                 // Calculate midpoint for delete button (clamped to screen)
                 const midX = Math.min(Math.max((coords.x1 + coords.x1 + 100) / 2, 20), (chartContainerRef.current?.clientWidth || 500) - 20);
                 const midY = (coords.y1 + (coords.y2 - coords.y1) * ((midX - coords.x1) / (coords.x2 - coords.x1)));

                 return (
                     <g key={t.id} className="group pointer-events-auto">
                        {/* Hover Target (wider transparent line) */}
                        <line 
                           x1={coords.x1} y1={coords.y1} x2={coords.x2} y2={coords.y2} 
                           stroke="transparent" 
                           strokeWidth="15" 
                        />
                        {/* Visible Line (Ray) */}
                        <line 
                           x1={coords.x1} y1={coords.y1} x2={coords.x2} y2={coords.y2} 
                           stroke={THEME.accent} 
                           strokeWidth="2"
                        />
                        {/* Anchor Dot */}
                         <circle cx={coords.x1} cy={coords.y1} r="3" fill={THEME.accent} />

                        {/* Delete Button (visible on hover) */}
                        <g 
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onDeleteTrendline) onDeleteTrendline(t.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                        >
                            <circle cx={midX} cy={midY} r="8" fill={THEME.panel} stroke={THEME.border} />
                            <text 
                                x={midX} y={midY} 
                                dy=".3em" textAnchor="middle" 
                                fill={THEME.danger} 
                                fontSize="10" 
                                fontWeight="bold"
                            >
                                ✕
                            </text>
                        </g>
                     </g>
                 );
             })}

             {/* Drawing Preview Line (Ray) */}
             {isDrawing && drawP1 && drawP2 && (
                 (() => {
                    const coords = getRayCoordinates(drawP1, drawP2);
                    if (!coords) return null;
                    return (
                        <g>
                            <line 
                                x1={coords.x1} y1={coords.y1} x2={coords.x2} y2={coords.y2} 
                                stroke={THEME.textMain} 
                                strokeWidth="2"
                                strokeDasharray="4"
                                opacity="0.8"
                            />
                            <circle cx={coords.x1} cy={coords.y1} r="3" fill={THEME.textMain} />
                        </g>
                    );
                 })()
             )}
        </svg>

        {/* Drawing Mode Overlay (Captures clicks when drawing) */}
        {isDrawing && (
            <div 
                className="absolute inset-0 z-20 cursor-crosshair"
                onClick={handleDrawClick}
                onMouseMove={handleDrawMove}
            >
                {/* Cancel hint */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#0d1117]/80 text-white text-xs px-3 py-1 rounded border border-[#30363d] backdrop-blur select-none">
                   {drawP1 ? 'Click to set direction' : 'Click start point'} (Esc to cancel)
                </div>
            </div>
        )}

        {/* Draw Toggle Button */}
        <div className="absolute top-2 left-2 z-30">
            <button
                onClick={() => {
                    if (isDrawing) {
                        setIsDrawing(false);
                        setDrawP1(null);
                        setDrawP2(null);
                    } else {
                        setIsDrawing(true);
                    }
                }}
                className={`p-1.5 rounded border shadow-sm transition-all ${
                    isDrawing 
                    ? 'bg-[#58a6ff] text-white border-[#58a6ff]' 
                    : 'bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-white'
                }`}
                title="Draw Trendline Ray"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
            </button>
        </div>
    </div>
  );
};

export default TVChart;
