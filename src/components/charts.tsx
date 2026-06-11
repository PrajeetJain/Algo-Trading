import { useMemo } from "react";
import type { CandlePayload, EnginePosition } from "../types";
import { formatCurrency, timeLabelFromIso } from "../lib/format";

/**
 * Intraday P&L sparkline from the bot engine's pnl series.
 */
export function EquityCurve({
  series,
  targetAmount,
  lossAmount,
}: {
  series: Array<{ t: string; pnl: number }>;
  targetAmount: number;
  lossAmount: number;
}) {
  const width = 640;
  const height = 120;
  const path = useMemo(() => {
    if (series.length < 2) {
      return null;
    }
    const values = series.map((point) => point.pnl);
    const min = Math.min(...values, -lossAmount * 0.4, 0);
    const max = Math.max(...values, targetAmount * 0.4, 0);
    const range = max - min || 1;
    const xFor = (index: number) => (index / (series.length - 1)) * width;
    const yFor = (value: number) => height - ((value - min) / range) * height;
    return {
      line: series.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)},${yFor(point.pnl).toFixed(1)}`).join(" "),
      zeroY: yFor(0),
      last: series[series.length - 1],
      lastY: yFor(values[values.length - 1]),
    };
  }, [series, targetAmount, lossAmount]);

  if (!path) {
    return <div className="journal-empty">No P&L samples yet today</div>;
  }

  const lastPnl = path.last.pnl;
  return (
    <div className="equity-chart" aria-label="Intraday P&L curve">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <line x1={0} y1={path.zeroY} x2={width} y2={path.zeroY} className="equity-zero" />
        <path d={path.line} className={lastPnl >= 0 ? "equity-line gain" : "equity-line loss"} fill="none" />
        <circle cx={width} cy={path.lastY} r={3.5} className={lastPnl >= 0 ? "equity-dot gain" : "equity-dot loss"} />
      </svg>
      <div className="equity-meta">
        <span>{timeLabelFromIso(series[0].t)}</span>
        <strong className={lastPnl >= 0 ? "gain" : "loss"}>{formatCurrency(lastPnl, 2)}</strong>
        <span>{timeLabelFromIso(path.last.t)}</span>
      </div>
    </div>
  );
}

/**
 * Compact SVG candlestick chart with entry / stop / target markers for the
 * open position (or just price action for the watched symbol).
 */
export function CandleChart({ payload, position }: { payload: CandlePayload; position: EnginePosition | null }) {
  const width = 640;
  const height = 220;
  const candles = payload.candles.slice(-60);

  const geometry = useMemo(() => {
    if (candles.length < 2) {
      return null;
    }
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (position) {
      min = Math.min(min, position.stopLoss ?? min, position.target ?? min, position.entryPrice);
      max = Math.max(max, position.stopLoss ?? max, position.target ?? max, position.entryPrice);
    }
    const pad = (max - min) * 0.05 || 1;
    min -= pad;
    max += pad;
    const range = max - min || 1;
    const step = width / candles.length;
    const yFor = (value: number) => height - ((value - min) / range) * height;
    return { min, max, step, yFor };
  }, [candles, position]);

  if (!geometry) {
    return <div className="journal-empty">No candles yet — connect Zerodha for live data</div>;
  }

  const { step, yFor } = geometry;
  const markers: Array<{ label: string; value: number; tone: string }> = [];
  if (position) {
    markers.push({ label: `Entry ${formatCurrency(position.entryPrice, 2)}`, value: position.entryPrice, tone: "entry" });
    if (position.stopLoss) {
      markers.push({ label: `Stop ${formatCurrency(position.stopLoss, 2)}`, value: position.stopLoss, tone: "stop" });
    }
    if (position.target) {
      markers.push({ label: `Target ${formatCurrency(position.target, 2)}`, value: position.target, tone: "target" });
    }
  }

  return (
    <div className="candle-chart" aria-label={`${payload.symbol} candles`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        {candles.map((candle, index) => {
          const x = index * step + step / 2;
          const bodyTop = yFor(Math.max(candle.open, candle.close));
          const bodyBottom = yFor(Math.min(candle.open, candle.close));
          const up = candle.close >= candle.open;
          return (
            <g key={candle.time} className={up ? "candle up" : "candle down"}>
              <line x1={x} y1={yFor(candle.high)} x2={x} y2={yFor(candle.low)} />
              <rect
                x={x - Math.max(1, step * 0.3)}
                y={bodyTop}
                width={Math.max(2, step * 0.6)}
                height={Math.max(1, bodyBottom - bodyTop)}
              />
            </g>
          );
        })}
        {markers.map((marker) => (
          <g key={marker.tone} className={`price-marker ${marker.tone}`}>
            <line x1={0} y1={yFor(marker.value)} x2={width} y2={yFor(marker.value)} />
            <text x={6} y={yFor(marker.value) - 4}>
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="equity-meta">
        <span>{payload.symbol}</span>
        <span>{candles.length} x 5min</span>
        <span>{payload.source}</span>
      </div>
    </div>
  );
}
