import { appendEvent, saveJson } from "./database.js";
import { generateSignals, sizePosition } from "./strategy.js";
import { watchlist } from "./watchlist.js";

function charges(buyValue, sellValue) {
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
  const stt = sellValue * 0.00025;
  const exchangeTxn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = (brokerage + exchangeTxn + sebi) * 0.18;
  return brokerage + stt + exchangeTxn + sebi + stamp + gst;
}

export async function runBacktest({ config, quotes, candlesBySymbol }) {
  const trades = [];
  const equity = [{ step: 0, pnl: 0 }];
  const returns = [];
  let pnl = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalCharges = 0;
  let maxDrawdown = 0;
  let peak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveLosses = 0;

  for (const item of watchlist.slice(0, 8)) {
    const candles = candlesBySymbol[item.tradingsymbol] ?? [];
    if (candles.length < 30) {
      continue;
    }

    for (let index = 25; index < candles.length - 4 && trades.length < 60; index += 5) {
      const slice = candles.slice(0, index + 1);
      const latest = slice.at(-1);
      const quote = {
        instrument: `${item.exchange}:${item.tradingsymbol}`,
        exchange: item.exchange,
        symbol: item.tradingsymbol,
        name: item.name,
        sector: item.sector,
        source: "backtest",
        ltp: latest.close,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: slice.at(-2)?.close ?? latest.close,
        volume: latest.volume,
        bestBid: latest.close * 0.9995,
        bestAsk: latest.close * 1.0005,
        spreadBps: 10,
      };
      const signals = generateSignals({
        quotes: [quote, ...quotes.filter((entry) => entry.symbol === "NIFTY 50")],
        candlesBySymbol: { [item.tradingsymbol]: slice },
        config,
      });
      const signal = signals[0];
      if (!signal?.eligible) {
        continue;
      }

      const side = signal.side ?? "BUY";
      const sizing = sizePosition({ price: latest.close, atrValue: signal.atr, config, side });
      if (sizing.quantity <= 0) {
        continue;
      }

      const slippage = config.slippageBps / 10000;
      const entry = side === "SELL" ? latest.close * (1 - slippage) : latest.close * (1 + slippage);
      const qty = sizing.quantity;
      let exit = side === "SELL" ? candles[index + 4].close * (1 + slippage) : candles[index + 4].close * (1 - slippage);
      let exitReason = "time-exit";
      for (const candle of candles.slice(index + 1, index + 7)) {
        if (side === "SELL" && candle.high >= signal.stopLossPrice) {
          exit = signal.stopLossPrice * (1 + slippage);
          exitReason = "stop-loss";
          break;
        }
        if (side === "SELL" && candle.low <= signal.targetPrice) {
          exit = signal.targetPrice * (1 + slippage);
          exitReason = "target";
          break;
        }
        if (side !== "SELL" && candle.low <= signal.stopLossPrice) {
          exit = signal.stopLossPrice * (1 - slippage);
          exitReason = "stop-loss";
          break;
        }
        if (side !== "SELL" && candle.high >= signal.targetPrice) {
          exit = signal.targetPrice * (1 - slippage);
          exitReason = "target";
          break;
        }
      }
      const gross = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
      const buyValue = (side === "SELL" ? exit : entry) * qty;
      const sellValue = (side === "SELL" ? entry : exit) * qty;
      const cost = charges(buyValue, sellValue);
      const net = gross - cost;
      totalCharges += cost;
      pnl += net;
      if (net >= 0) {
        wins += 1;
        grossProfit += net;
        currentLossStreak = 0;
      } else {
        losses += 1;
        grossLoss += Math.abs(net);
        currentLossStreak += 1;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
      }
      returns.push(net / config.capital);
      peak = Math.max(peak, pnl);
      maxDrawdown = Math.min(maxDrawdown, pnl - peak);
      trades.push({
        symbol: item.tradingsymbol,
        entry,
        exit,
        side,
        qty,
        net,
        charges: cost,
        score: signal.score,
        strategy: signal.strategy,
        exitReason,
      });
      equity.push({ step: equity.length, pnl });
    }
  }

  const averageReturn = returns.length ? returns.reduce((total, value) => total + value, 0) / returns.length : 0;
  const returnVariance = returns.length
    ? returns.reduce((total, value) => total + (value - averageReturn) ** 2, 0) / returns.length
    : 0;
  const returnStdDev = Math.sqrt(returnVariance);
  const sharpeRatio = returnStdDev ? (averageReturn / returnStdDev) * Math.sqrt(Math.max(1, returns.length)) : 0;

  const result = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "historical-or-simulated-candles",
    capital: config.capital,
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    netPnl: pnl,
    maxDrawdown,
    expectancy: trades.length ? pnl / trades.length : 0,
    sharpeRatio,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? 99 : 0,
    avgWin: wins ? grossProfit / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    grossProfit,
    grossLoss,
    totalCharges,
    maxConsecutiveLosses,
    sampleTrades: trades.slice(-10).reverse(),
    equity,
  };
  saveJson("latest-backtest.json", result);
  appendEvent("backtest.run", { id: result.id, trades: result.trades, netPnl: result.netPnl });
  return result;
}
