import { appendEvent, readJson, saveJson } from "./database.js";
import { charges } from "./ledger.js";
import * as candleStore from "./candleStore.js";
import { candleCoverage, upsertCandles } from "./candleStore.js";
import { agentDecision, generateSignals, strategyProfile } from "./strategy.js";
import { watchlist } from "./watchlist.js";

const INTERVAL = "5minute";
const CONTEXT_DAYS = 2; // prior days fed to indicators, mirroring the live 3-day window
const ASSUMED_SPREAD_BPS = 10;
const DECISION_STEP = 3; // evaluate entries every 3rd candle (15 min); exits every candle

function minutesOf(time) {
  const match = /T(\d{2}):(\d{2})/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function symbolsUniverse() {
  return [...watchlist.map((item) => item.tradingsymbol), "NIFTY 50"];
}

/**
 * Downloads historical candles from Kite into the local store. Backtests only
 * ever run on stored real candles — never simulated ones.
 */
export async function syncHistoricalCandles({ kiteClient, tokenReady, days = 60, getInstrumentToken }) {
  if (!tokenReady) {
    throw new Error("Connect Zerodha first. Historical sync needs a live Kite token.");
  }
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const format = (date) => date.toISOString().slice(0, 19).replace("T", " ");
  const synced = [];
  for (const symbol of symbolsUniverse()) {
    const token = await getInstrumentToken(symbol);
    if (!token) {
      synced.push({ symbol, candles: 0, error: "no instrument token" });
      continue;
    }
    const data = await kiteClient.historical(token, INTERVAL, format(from), format(to));
    const candles = (data.candles ?? []).map((row) => ({
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    }));
    const count = upsertCandles(symbol, INTERVAL, candles);
    synced.push({ symbol, candles: count });
  }
  appendEvent("backtest.candles_synced", { days, synced });
  return { synced, coverage: candleCoverage(INTERVAL) };
}

function groupByDay(candles) {
  const byDay = new Map();
  for (const candle of candles) {
    const day = candle.time.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(candle);
  }
  return byDay;
}

/**
 * Replays the exact live strategy (generateSignals + agentDecision) over
 * stored candles, one trading day at a time, with the same risk rules the
 * bot engine enforces: one position, max trades/day, daily target/loss
 * locks, square-off, slippage and full charges.
 */
export function replayBacktest({
  config,
  days = null,
  stepCandles = DECISION_STEP,
  spreadBps = ASSUMED_SPREAD_BPS,
  store = candleStore,
}) {
  const allDays = store.storedDays(INTERVAL);
  const replayDays = days?.length ? allDays.filter((day) => days.includes(day)) : allDays;
  if (!replayDays.length) {
    throw new Error("No stored candles. Run candle sync first (POST /api/backtest/sync-candles).");
  }

  const symbols = symbolsUniverse();
  const candlesBySymbolAll = new Map();
  for (const symbol of symbols) {
    const contextFrom = Math.max(0, allDays.indexOf(replayDays[0]) - CONTEXT_DAYS);
    const wantedDays = allDays.slice(contextFrom, allDays.indexOf(replayDays[replayDays.length - 1]) + 1);
    candlesBySymbolAll.set(symbol, groupByDay(store.candlesForDays(symbol, INTERVAL, wantedDays)));
  }

  const trades = [];
  const dailyResults = [];
  const slippage = (config.slippageBps ?? 8) / 10000;

  for (const day of replayDays) {
    const dayIndexInAll = allDays.indexOf(day);
    const contextDays = allDays.slice(Math.max(0, dayIndexInAll - CONTEXT_DAYS), dayIndexInAll);
    const dayCandles = new Map();
    const contextCandles = new Map();
    const prevCloseBySymbol = new Map();
    for (const symbol of symbols) {
      const byDay = candlesBySymbolAll.get(symbol);
      dayCandles.set(symbol, byDay.get(day) ?? []);
      const context = contextDays.flatMap((contextDay) => byDay.get(contextDay) ?? []);
      contextCandles.set(symbol, context);
      prevCloseBySymbol.set(symbol, context.at(-1)?.close ?? byDay.get(day)?.[0]?.open ?? 0);
    }

    const driver = dayCandles.get("NIFTY 50")?.length ? dayCandles.get("NIFTY 50") : dayCandles.get(symbols[0]) ?? [];
    let openPosition = null;
    let realized = 0;
    let tradesTaken = 0;
    let locked = null;
    const targetAmount = (config.capital * config.targetPct) / 100;
    const lossAmount = (config.capital * config.maxLossPct) / 100;

    function exitAt(rawPrice, time, reason) {
      const exitPrice = openPosition.side === "SHORT" ? rawPrice * (1 + slippage) : rawPrice * (1 - slippage);
      const entryValue = openPosition.entryPrice * openPosition.quantity;
      const exitValue = exitPrice * openPosition.quantity;
      const buyValue = openPosition.side === "SHORT" ? exitValue : entryValue;
      const sellValue = openPosition.side === "SHORT" ? entryValue : exitValue;
      const cost = charges(buyValue, sellValue);
      const gross = openPosition.side === "SHORT" ? entryValue - exitValue : exitValue - entryValue;
      const net = gross - cost;
      realized += net;
      trades.push({
        ...openPosition,
        exitPrice,
        exitAt: time,
        exitReason: reason,
        grossPnl: gross,
        charges: cost,
        netPnl: net,
      });
      openPosition = null;
    }

    for (let index = 0; index < driver.length; index += 1) {
      const time = driver[index].time;
      const minutes = minutesOf(time);

      // Manage the open position on every candle.
      if (openPosition) {
        const candle = (dayCandles.get(openPosition.symbol) ?? [])[index];
        if (candle) {
          // Same trade management as the live engine: breakeven + trailing
          // stops per strategy profile, driven by the candle's favorable
          // extreme. Trail updates use the same candle's extreme before the
          // exit check — mildly optimistic; the stop-first worst-case
          // ordering below compensates.
          const favorable =
            openPosition.side === "SHORT"
              ? openPosition.entryPrice - candle.low
              : candle.high - openPosition.entryPrice;
          openPosition.mfe = Math.max(openPosition.mfe ?? 0, favorable);
          const profile = strategyProfile(openPosition.strategy);
          const riskPerShare = openPosition.initialStop
            ? Math.abs(openPosition.entryPrice - openPosition.initialStop)
            : 0;
          if (riskPerShare > 0) {
            if (profile.breakevenAtR > 0 && openPosition.mfe >= riskPerShare * profile.breakevenAtR) {
              openPosition.stopLoss =
                openPosition.side === "SHORT"
                  ? Math.min(openPosition.stopLoss, openPosition.entryPrice)
                  : Math.max(openPosition.stopLoss, openPosition.entryPrice);
            }
            if (profile.trailAtR > 0 && profile.trailLockRatio > 0 && openPosition.mfe >= riskPerShare * profile.trailAtR) {
              const locked = openPosition.mfe * profile.trailLockRatio;
              openPosition.stopLoss =
                openPosition.side === "SHORT"
                  ? Math.min(openPosition.stopLoss, openPosition.entryPrice - locked)
                  : Math.max(openPosition.stopLoss, openPosition.entryPrice + locked);
            }
          }
          const stop = openPosition.stopLoss;
          const target = openPosition.target;
          // Worst-case ordering: if both stop and target fall inside one
          // candle, assume the stop hit first.
          if (openPosition.side === "LONG" && candle.low <= stop) {
            exitAt(stop, time, "stop-loss");
          } else if (openPosition.side === "SHORT" && candle.high >= stop) {
            exitAt(stop, time, "stop-loss");
          } else if (openPosition.side === "LONG" && candle.high >= target) {
            exitAt(target, time, "target");
          } else if (openPosition.side === "SHORT" && candle.low <= target) {
            exitAt(target, time, "target");
          } else {
            const mark = candle.close;
            const unrealizedGross =
              openPosition.side === "SHORT"
                ? (openPosition.entryPrice - mark) * openPosition.quantity
                : (mark - openPosition.entryPrice) * openPosition.quantity;
            if (realized + unrealizedGross >= targetAmount) {
              exitAt(mark, time, "daily-target");
              locked = "target-hit";
            } else if (realized + unrealizedGross <= -lossAmount) {
              exitAt(mark, time, "daily-loss");
              locked = "loss-hit";
            } else if (minutes >= 15 * 60 + 15) {
              exitAt(mark, time, "square-off");
            }
          }
        }
      }

      if (locked) {
        continue;
      }
      if (realized >= targetAmount) {
        locked = "target-hit";
        continue;
      }
      if (realized <= -lossAmount) {
        locked = "loss-hit";
        continue;
      }

      // Entry decisions on the stepped cadence inside the entry window.
      const inEntryWindow = minutes >= 9 * 60 + 20 && minutes < 15 * 60;
      if (openPosition || !inEntryWindow || tradesTaken >= config.maxTrades || index % stepCandles !== 0) {
        continue;
      }

      const quotes = [];
      const candlesBySymbol = {};
      for (const symbol of symbols) {
        const candlesToday = dayCandles.get(symbol) ?? [];
        const upTo = candlesToday.slice(0, index + 1);
        const latest = upTo.at(-1);
        if (!latest) {
          continue;
        }
        const item = watchlist.find((entry) => entry.tradingsymbol === symbol);
        quotes.push({
          instrument: `NSE:${symbol}`,
          exchange: "NSE",
          symbol,
          name: item?.name ?? symbol,
          sector: symbol === "NIFTY 50" ? "Index" : item?.sector ?? "Unknown",
          source: "backtest",
          ltp: latest.close,
          open: upTo[0].open,
          high: Math.max(...upTo.map((candle) => candle.high)),
          low: Math.min(...upTo.map((candle) => candle.low)),
          close: prevCloseBySymbol.get(symbol) || latest.close,
          volume: upTo.reduce((total, candle) => total + (candle.volume ?? 0), 0),
          bestBid: latest.close * (1 - spreadBps / 20000),
          bestAsk: latest.close * (1 + spreadBps / 20000),
          spreadBps,
        });
        candlesBySymbol[symbol] = [...contextCandles.get(symbol), ...upTo];
      }

      const signals = generateSignals({ quotes, candlesBySymbol, config, asOf: time });
      const decision = agentDecision(signals, config);
      if (decision.action !== "TRADE") {
        continue;
      }
      const signal = signals.find((item) => item.symbol === decision.symbol);
      if (!signal?.eligible || !decision.quantity) {
        continue;
      }
      const side = decision.side === "SELL" ? "SHORT" : "LONG";
      const entryPrice = decision.side === "SELL" ? signal.price * (1 - slippage) : signal.price * (1 + slippage);
      openPosition = {
        tradeDate: day,
        symbol: decision.symbol,
        side,
        quantity: decision.quantity,
        entryPrice,
        entryAt: time,
        stopLoss: decision.stopLossPrice,
        initialStop: decision.stopLossPrice,
        target: decision.targetPrice,
        strategy: decision.strategy,
        score: decision.score ?? signal.score,
        mfe: 0,
      };
      tradesTaken += 1;
    }

    if (openPosition) {
      const lastCandle = (dayCandles.get(openPosition.symbol) ?? []).at(-1) ?? { close: openPosition.entryPrice, time: driver.at(-1)?.time };
      exitAt(lastCandle.close, lastCandle.time ?? `${day}T15:30:00+05:30`, "eod-close");
    }

    dailyResults.push({ day, netPnl: realized, trades: tradesTaken, locked: locked ?? "none" });
  }

  return summarizeReplay({ config, trades, dailyResults });
}

function summarizeReplay({ config, trades, dailyResults }) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const dailyReturns = [];
  for (const day of dailyResults) {
    equity += day.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    dailyReturns.push(day.netPnl / config.capital);
  }
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((total, trade) => total + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.netPnl, 0));
  let lossStreak = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of trades) {
    lossStreak = trade.netPnl < 0 ? lossStreak + 1 : 0;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, lossStreak);
  }
  const avgReturn = dailyReturns.length ? dailyReturns.reduce((total, value) => total + value, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length
    ? dailyReturns.reduce((total, value) => total + (value - avgReturn) ** 2, 0) / dailyReturns.length
    : 0;
  const stdDev = Math.sqrt(variance);

  const byStrategy = new Map();
  const byExitReason = new Map();
  for (const trade of trades) {
    const strategyBucket = byStrategy.get(trade.strategy) ?? { key: trade.strategy, trades: 0, netPnl: 0, wins: 0 };
    strategyBucket.trades += 1;
    strategyBucket.netPnl += trade.netPnl;
    strategyBucket.wins += trade.netPnl > 0 ? 1 : 0;
    byStrategy.set(trade.strategy, strategyBucket);
    const reasonBucket = byExitReason.get(trade.exitReason) ?? { key: trade.exitReason, trades: 0, netPnl: 0 };
    reasonBucket.trades += 1;
    reasonBucket.netPnl += trade.netPnl;
    byExitReason.set(trade.exitReason, reasonBucket);
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "stored-historical-candles",
    capital: config.capital,
    days: dailyResults.length,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 100) : 0,
    netPnl: equity,
    expectancy: trades.length ? equity / trades.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? 99 : 0,
    maxDrawdown,
    sharpeRatio: stdDev ? (avgReturn / stdDev) * Math.sqrt(Math.max(1, dailyReturns.length)) : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    totalCharges: trades.reduce((total, trade) => total + trade.charges, 0),
    maxConsecutiveLosses,
    byStrategy: [...byStrategy.values()].sort((a, b) => b.netPnl - a.netPnl),
    byExitReason: [...byExitReason.values()].sort((a, b) => b.trades - a.trades),
    daily: dailyResults,
    sampleTrades: trades.slice(-20).reverse(),
  };
}

function cartesianGrid(gridSpec) {
  const keys = Object.keys(gridSpec);
  if (!keys.length) {
    return [{}];
  }
  let combos = [{}];
  for (const key of keys) {
    const values = gridSpec[key];
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })));
  }
  return combos;
}

/**
 * Walk-forward validation: pick the best parameter combo on each training
 * window, then measure it on the *following* unseen test window. The
 * aggregated out-of-sample result is the honest estimate of edge.
 */
export function walkForward({
  baseConfig,
  gridSpec = { minScore: [65, 70, 75], minNetRewardRisk: [1.0, 1.2, 1.5] },
  trainDays = 10,
  testDays = 5,
  store = candleStore,
}) {
  const days = store.storedDays(INTERVAL);
  if (days.length < trainDays + testDays) {
    throw new Error(
      `Need at least ${trainDays + testDays} stored trading days, have ${days.length}. Sync more candles first.`
    );
  }
  const combos = cartesianGrid(gridSpec);
  const folds = [];
  let oosNetPnl = 0;
  let oosTrades = 0;
  let oosWins = 0;
  let trainNetPnlOfChosen = 0;

  for (let start = trainDays; start + testDays <= days.length; start += testDays) {
    const train = days.slice(start - trainDays, start);
    const test = days.slice(start, start + testDays);
    let best = null;
    for (const combo of combos) {
      const config = { ...baseConfig, ...combo };
      const result = replayBacktest({ config, days: train, store });
      if (!best || result.netPnl > best.result.netPnl) {
        best = { combo, result };
      }
    }
    const testResult = replayBacktest({ config: { ...baseConfig, ...best.combo }, days: test, store });
    oosNetPnl += testResult.netPnl;
    oosTrades += testResult.trades;
    oosWins += testResult.wins;
    trainNetPnlOfChosen += best.result.netPnl;
    folds.push({
      train: { from: train[0], to: train.at(-1), netPnl: best.result.netPnl, trades: best.result.trades },
      test: { from: test[0], to: test.at(-1), netPnl: testResult.netPnl, trades: testResult.trades, winRate: testResult.winRate },
      chosenParams: best.combo,
    });
  }

  const trainDailyAvg = trainNetPnlOfChosen / Math.max(1, folds.length * trainDays);
  const testDailyAvg = oosNetPnl / Math.max(1, folds.length * testDays);
  const overfitWarning =
    (trainDailyAvg > 0 && testDailyAvg <= 0) || (trainDailyAvg > 0 && testDailyAvg < trainDailyAvg * 0.25);

  const report = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    capital: baseConfig.capital,
    gridSpec,
    trainDays,
    testDays,
    folds,
    outOfSample: {
      netPnl: oosNetPnl,
      trades: oosTrades,
      winRate: oosTrades ? Math.round((oosWins / oosTrades) * 100) : 0,
      dailyAvgPnl: testDailyAvg,
    },
    inSample: {
      dailyAvgPnl: trainDailyAvg,
    },
    overfitWarning,
    verdict: overfitWarning
      ? "WARNING: parameters look overfit — out-of-sample performance collapses versus training."
      : oosNetPnl > 0
        ? "Out-of-sample positive. Keep collecting paper evidence before trusting it."
        : "Out-of-sample negative. The strategy as parameterized has no demonstrated edge.",
  };
  saveJson("latest-walkforward.json", report);
  appendEvent("backtest.walk_forward", { id: report.id, oosNetPnl, folds: folds.length, overfitWarning });
  return report;
}

export function latestWalkForward() {
  return readJson("latest-walkforward.json", null);
}

export function walkForwardCsv() {
  const report = latestWalkForward();
  if (!report) {
    return "";
  }
  const header = "fold,trainFrom,trainTo,trainNetPnl,trainTrades,chosenParams,testFrom,testTo,testNetPnl,testTrades,testWinRate";
  const rows = report.folds.map((fold, index) =>
    [
      index + 1,
      fold.train.from,
      fold.train.to,
      fold.train.netPnl.toFixed(2),
      fold.train.trades,
      `"${Object.entries(fold.chosenParams)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}"`,
      fold.test.from,
      fold.test.to,
      fold.test.netPnl.toFixed(2),
      fold.test.trades,
      fold.test.winRate,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}
