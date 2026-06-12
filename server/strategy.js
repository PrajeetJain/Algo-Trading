const IST_TIME_ZONE = "Asia/Kolkata";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function istDateKey(value) {
  // Kite timestamps use "+0530" which Date.parse does not always accept.
  const normalized = typeof value === "string" ? value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function sessionCandles(candles, now = new Date()) {
  const today = istDateKey(now);
  if (!today) {
    return [];
  }
  return candles.filter((candle) => istDateKey(candle.time) === today);
}

function istMinutesOfDay(value = new Date()) {
  const normalized = typeof value === "string" ? value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(lookup.hour) * 60 + Number(lookup.minute);
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function vwap(candles) {
  const totals = candles.reduce(
    (acc, candle) => {
      const typical = (candle.high + candle.low + candle.close) / 3;
      acc.priceVolume += typical * candle.volume;
      acc.volume += candle.volume;
      return acc;
    },
    { priceVolume: 0, volume: 0 }
  );
  return totals.volume ? totals.priceVolume / totals.volume : candles.at(-1)?.close ?? 0;
}

function atr(candles, period = 14) {
  const slice = candles.slice(-period - 1);
  if (slice.length < 2) {
    return 0;
  }
  const ranges = [];
  for (let index = 1; index < slice.length; index += 1) {
    const current = slice[index];
    const previous = slice[index - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  return ranges.reduce((total, item) => total + item, 0) / ranges.length;
}

// Volume pulse compares recent activity against the prior baseline. The
// newest candle may still be forming live (partial volume), so take the
// larger of the last two candles and baseline against the 20 candles before
// them — the baseline never includes the candles being measured.
export function volumePulse(candles) {
  if (candles.length < 3) {
    return 0;
  }
  const latest = Math.max(candles.at(-1)?.volume ?? 0, candles.at(-2)?.volume ?? 0);
  const prior = candles.slice(-22, -2);
  const average = prior.length ? prior.reduce((total, candle) => total + candle.volume, 0) / prior.length : 0;
  return average ? latest / average : 0;
}

function sma(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) {
    return 0;
  }
  const mean = sma(values);
  const variance = sma(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

// Wilder-smoothed RSI: seeds with a simple average over the first period,
// then applies exponential smoothing — far less jumpy than a plain average.
function rsi(candles, period = 14) {
  const slice = candles.slice(-(period * 3) - 1);
  if (slice.length < period + 1) {
    return 50;
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const move = slice[index].close - slice[index - 1].close;
    if (move >= 0) {
      avgGain += move / period;
    } else {
      avgLoss += Math.abs(move) / period;
    }
  }
  for (let index = period + 1; index < slice.length; index += 1) {
    const move = slice[index].close - slice[index - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(0, move)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -move)) / period;
  }
  if (!avgLoss) {
    return 100;
  }
  const relativeStrength = avgGain / avgLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function bollinger(candles, period = 20) {
  const closes = candles.slice(-period).map((candle) => candle.close);
  const middle = sma(closes);
  const deviation = stddev(closes);
  return {
    lower: middle - deviation * 2,
    middle,
    upper: middle + deviation * 2,
  };
}

function openingRange(candles) {
  const range = candles.slice(0, Math.min(6, candles.length));
  if (!range.length) {
    return { high: 0, low: 0 };
  }
  return {
    high: Math.max(...range.map((candle) => candle.high)),
    low: Math.min(...range.map((candle) => candle.low)),
  };
}

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

function estimateRoundTrip({ side, entryPrice, targetPrice, quantity, slippageBps = 8 }) {
  const slippage = slippageBps / 10000;
  const entry = side === "SELL" ? entryPrice * (1 - slippage) : entryPrice * (1 + slippage);
  const exit = side === "SELL" ? targetPrice * (1 + slippage) : targetPrice * (1 - slippage);
  const grossReward = Math.abs(exit - entry) * quantity;
  const buyValue = side === "SELL" ? exit * quantity : entry * quantity;
  const sellValue = side === "SELL" ? entry * quantity : exit * quantity;
  return {
    grossReward,
    estimatedCharges: charges(buyValue, sellValue),
  };
}

function candleMovePct(candles, lookback = 12) {
  const end = candles.at(-1)?.close;
  const start = candles.at(-lookback)?.close ?? candles.at(0)?.close;
  return start && end ? ((end - start) / start) * 100 : 0;
}

/**
 * Broad market context beyond NIFTY 50: India VIX level, Bank Nifty bias for
 * banking names, and watchlist breadth (advancers vs decliners).
 */
export function computeMarketContext(quotes) {
  const indexBias = (symbol) => {
    const quote = quotes.find((item) => item.symbol === symbol);
    return quote?.close ? ((quote.ltp - quote.close) / quote.close) * 100 : 0;
  };
  const vixQuote = quotes.find((item) => item.symbol === "INDIA VIX");
  const tradables = quotes.filter((item) => item.sector !== "Index");
  const advancers = tradables.filter((item) => item.close && item.ltp > item.close).length;
  const decliners = tradables.filter((item) => item.close && item.ltp < item.close).length;
  const advanceDeclineRatio = decliners ? advancers / decliners : advancers ? 99 : 1;
  return {
    niftyBias: indexBias("NIFTY 50"),
    bankNiftyBias: indexBias("NIFTY BANK"),
    vix: vixQuote?.ltp ?? null,
    advancers,
    decliners,
    advanceDeclineRatio,
    breadth: advanceDeclineRatio >= 1.5 ? "positive" : advanceDeclineRatio <= 0.67 ? "negative" : "flat",
  };
}

function detectMarketRegime({ niftyBias = 0, niftyCandles = [], asOf = new Date(), vix = null, breadth = "flat" }) {
  // Trend must come from today's session only — a 12-candle lookback over a
  // multi-day window would read yesterday's move (and overnight gap) as trend.
  // ATR keeps the full window: volatility benefits from more history.
  const todayCandles = sessionCandles(niftyCandles, asOf);
  const trendCandles = todayCandles.length >= 8 ? todayCandles : [];
  const trendPct = trendCandles.length ? candleMovePct(trendCandles, 12) : niftyBias;
  const niftyAtr = atr(niftyCandles);
  const lastClose = niftyCandles.at(-1)?.close ?? 0;
  const atrPct = lastClose ? (niftyAtr / lastClose) * 100 : 0;
  const combinedTrend = Math.abs(trendPct) > Math.abs(niftyBias) ? trendPct : niftyBias;
  const bias = combinedTrend > 0.18 ? "bullish" : combinedTrend < -0.18 ? "bearish" : "neutral";
  const vixElevated = Number.isFinite(vix) && vix > 20;
  const volatility = vixElevated || atrPct > 0.35 ? "high" : atrPct > 0.18 ? "normal" : "low";
  const state =
    volatility === "high"
      ? "volatile"
      : Math.abs(combinedTrend) >= 0.45
        ? "trend"
        : Math.abs(combinedTrend) <= 0.12
          ? "sideways"
          : "mixed";

  return {
    state,
    bias,
    trendPct: combinedTrend,
    volatility,
    atrPct,
    vix,
    breadth,
    label: `${state}/${bias}`,
  };
}

function regimeSupportsSignal(regime, side, mode) {
  if (mode === "mean-reversion") {
    return regime.state !== "trend" || regime.bias === "neutral";
  }
  if (regime.bias === "neutral") {
    return true;
  }
  return side === "SELL" ? regime.bias === "bearish" : regime.bias === "bullish";
}

function strategyScores({ quote, candles, intradayCandles, momentumPct, dayMomentumPct, aboveVwap, vwapDistancePct, pulse, niftyBias, relativeStrengthPct, marketRegime }) {
  const closeValues = candles.slice(-20).map((candle) => candle.close);
  const bands = bollinger(candles);
  const signalRsi = rsi(candles);
  // Opening range must be today's first candles, and classic ORB only trades
  // once the range is COMPLETE (6 x 5min candles = 09:15-09:45). Before that
  // a "breakout" is just noise against a 1-2 candle range, so the
  // opening-range candidates score zero until the range has formed.
  const rangeComplete = (intradayCandles?.length ?? 0) >= 6;
  const range = openingRange(intradayCandles ?? []);
  const bandWidth = bands.upper - bands.lower;
  const lowerBandDistance = bandWidth ? ((quote.ltp - bands.lower) / bandWidth) * 100 : 50;
  const upperBandDistance = bandWidth ? ((bands.upper - quote.ltp) / bandWidth) * 100 : 50;
  const breakout = range.high ? ((quote.ltp - range.high) / range.high) * 100 : 0;
  const breakdown = range.low ? ((range.low - quote.ltp) / range.low) * 100 : 0;
  const bullishRegime = marketRegime.bias === "bullish" ? 10 : marketRegime.bias === "neutral" ? 5 : 0;
  const bearishRegime = marketRegime.bias === "bearish" ? 10 : marketRegime.bias === "neutral" ? 5 : 0;

  const momentum = {
    mode: "momentum",
    label: "Momentum",
    side: "BUY",
    score:
      clamp(momentumPct * 14 + dayMomentumPct * 8, 0, 34) +
      clamp(relativeStrengthPct * 18, 0, 18) +
      clamp((pulse - 0.85) * 18, 0, 20) +
      clamp(niftyBias * 6 + 6, 0, 12) +
      bullishRegime +
      (aboveVwap ? 14 : 0),
    setup: `trend ${momentumPct.toFixed(2)}%, RS ${relativeStrengthPct.toFixed(2)}%, volume ${pulse.toFixed(2)}x`,
  };

  const meanReversion = {
    mode: "mean-reversion",
    label: "Mean Reversion",
    side: "BUY",
    score:
      clamp((35 - signalRsi) * 1.4, 0, 32) +
      clamp(28 - lowerBandDistance, 0, 28) +
      clamp((pulse - 0.7) * 10, 0, 12) +
      clamp(12 - Math.abs(niftyBias) * 4, 0, 12) +
      (marketRegime.state === "sideways" ? 10 : 0),
    setup: `RSI ${signalRsi.toFixed(0)}, lower band ${lowerBandDistance.toFixed(0)}%`,
  };

  // A pullback entry requires price NEAR VWAP, not merely above it — full
  // points at VWAP, fading to zero 0.4% away. Buying a stock 1%+ extended
  // above VWAP is chasing, and the backtest showed it loses (16% win rate).
  const vwapProximityLong = aboveVwap ? clamp(20 - vwapDistancePct * 50, 0, 20) : 0;
  const vwapProximityShort = !aboveVwap ? clamp(20 - -vwapDistancePct * 50, 0, 20) : 0;

  const vwapPullback = {
    mode: "vwap-pullback",
    label: "VWAP Pullback",
    side: "BUY",
    score:
      vwapProximityLong +
      clamp(relativeStrengthPct * 14, 0, 16) +
      clamp((pulse - 0.8) * 16, 0, 20) +
      clamp(dayMomentumPct * 14, 0, 20) +
      clamp(14 - Math.abs(momentumPct) * 3, 0, 14) +
      bullishRegime,
    setup: `${vwapDistancePct.toFixed(2)}% from VWAP, pullback pressure ${Math.abs(momentumPct).toFixed(2)}%`,
  };

  const openingBreakout = {
    mode: "opening-range",
    label: "Opening Range",
    side: "BUY",
    score: rangeComplete
      ? clamp(breakout * 42, 0, 30) +
        clamp(relativeStrengthPct * 16, 0, 18) +
        clamp((pulse - 1) * 18, 0, 22) +
        clamp(dayMomentumPct * 10, 0, 18) +
        bullishRegime +
        (quote.ltp > sma(closeValues) ? 8 : 0)
      : 0,
    setup: rangeComplete
      ? `range breakout ${breakout.toFixed(2)}%, volume ${pulse.toFixed(2)}x`
      : "opening range still forming",
  };

  const shortMomentum = {
    mode: "momentum",
    label: "Short Momentum",
    side: "SELL",
    score:
      clamp(-momentumPct * 14 + -dayMomentumPct * 8, 0, 34) +
      clamp(-relativeStrengthPct * 18, 0, 18) +
      clamp((pulse - 0.85) * 18, 0, 20) +
      clamp(-niftyBias * 6 + 6, 0, 12) +
      bearishRegime +
      (!aboveVwap ? 14 : 0),
    setup: `downtrend ${momentumPct.toFixed(2)}%, RS ${relativeStrengthPct.toFixed(2)}%, volume ${pulse.toFixed(2)}x`,
  };

  const shortMeanReversion = {
    mode: "mean-reversion",
    label: "Short Mean Reversion",
    side: "SELL",
    score:
      clamp((signalRsi - 65) * 1.4, 0, 32) +
      clamp(28 - upperBandDistance, 0, 28) +
      clamp((pulse - 0.7) * 10, 0, 12) +
      clamp(12 - Math.abs(niftyBias) * 4, 0, 12) +
      (marketRegime.state === "sideways" ? 10 : 0),
    setup: `RSI ${signalRsi.toFixed(0)}, upper band ${upperBandDistance.toFixed(0)}%`,
  };

  const shortVwapPullback = {
    mode: "vwap-pullback",
    label: "Short VWAP Pullback",
    side: "SELL",
    score:
      vwapProximityShort +
      clamp(-relativeStrengthPct * 14, 0, 16) +
      clamp((pulse - 0.8) * 16, 0, 20) +
      clamp(-dayMomentumPct * 14, 0, 20) +
      clamp(14 - Math.abs(momentumPct) * 3, 0, 14) +
      bearishRegime,
    setup: `${vwapDistancePct.toFixed(2)}% from VWAP, pullback pressure ${Math.abs(momentumPct).toFixed(2)}%`,
  };

  const openingBreakdown = {
    mode: "opening-range",
    label: "Opening Breakdown",
    side: "SELL",
    score: rangeComplete
      ? clamp(breakdown * 42, 0, 30) +
        clamp(-relativeStrengthPct * 16, 0, 18) +
        clamp((pulse - 1) * 18, 0, 22) +
        clamp(-dayMomentumPct * 10, 0, 18) +
        bearishRegime +
        (quote.ltp < sma(closeValues) ? 8 : 0)
      : 0,
    setup: rangeComplete
      ? `range breakdown ${breakdown.toFixed(2)}%, volume ${pulse.toFixed(2)}x`
      : "opening range still forming",
  };

  return [momentum, meanReversion, vwapPullback, openingBreakout, shortMomentum, shortMeanReversion, shortVwapPullback, openingBreakdown].map((strategy) => ({
    ...strategy,
    score: Math.round(clamp(strategy.score, 0, 100)),
  }));
}

function selectStrategy(scores, config) {
  const mode = config.strategyMode ?? "hybrid";
  if (mode === "hybrid") {
    return scores.sort((a, b) => b.score - a.score)[0];
  }
  return scores.find((score) => score.mode === mode) ?? scores[0];
}

/**
 * Sector strength: average day momentum per sector across the watchlist,
 * ranked strongest-first. Longs prefer strong sectors, shorts weak ones.
 */
export function computeSectorStrength(quotes, niftyBias = 0) {
  const tradables = quotes.filter((quote) => quote.sector !== "Index");
  const bySector = new Map();
  for (const quote of tradables) {
    const dayMomentum = quote.close ? ((quote.ltp - quote.close) / quote.close) * 100 : 0;
    const bucket = bySector.get(quote.sector) ?? { sector: quote.sector, members: 0, totalMomentum: 0 };
    bucket.members += 1;
    bucket.totalMomentum += dayMomentum;
    bySector.set(quote.sector, bucket);
  }
  return [...bySector.values()]
    .map((bucket) => ({
      sector: bucket.sector,
      members: bucket.members,
      avgMomentumPct: bucket.totalMomentum / bucket.members,
      avgRelativeStrengthPct: bucket.totalMomentum / bucket.members - niftyBias,
    }))
    .sort((a, b) => b.avgMomentumPct - a.avgMomentumPct)
    .map((bucket, index) => ({ ...bucket, rank: index + 1 }));
}

// Per-strategy risk profiles. Mean reversion aims for a closer target (the
// move back to value is shorter); momentum and opening-range give winners
// more room and use trailing stops once the trade is in profit.
const STRATEGY_PROFILES = {
  momentum: { stopMult: 1, targetMult: 1.25, breakevenAtR: 0.5, trailAtR: 1, trailLockRatio: 0.5 },
  "mean-reversion": { stopMult: 0.9, targetMult: 0.75, breakevenAtR: 0.6, trailAtR: 0, trailLockRatio: 0 },
  "vwap-pullback": { stopMult: 1, targetMult: 1, breakevenAtR: 0.5, trailAtR: 1.2, trailLockRatio: 0.5 },
  "opening-range": { stopMult: 1.1, targetMult: 1.3, breakevenAtR: 0.5, trailAtR: 1, trailLockRatio: 0.5 },
  hybrid: { stopMult: 1, targetMult: 1, breakevenAtR: 0.5, trailAtR: 1, trailLockRatio: 0.5 },
};

export function strategyProfile(mode) {
  return STRATEGY_PROFILES[mode] ?? STRATEGY_PROFILES.hybrid;
}

export function sizePosition({ price, atrValue = 0, config, side = "BUY", strategyMode = "hybrid" }) {
  const profile = strategyProfile(strategyMode);
  const stopLossPct = safeNumber(config.stopLossPct, 0.8) * profile.stopMult;
  const takeProfitPct = safeNumber(config.takeProfitPct, 1.6) * profile.targetMult;
  const capital = safeNumber(config.capital, 0);
  const riskPerTradePct = safeNumber(config.riskPerTradePct, 0.25);
  const atrStopMultiplier = safeNumber(config.atrStopMultiplier, 1.5);
  const riskAmount = (capital * riskPerTradePct) / 100;
  const percentStopDistance = price * (stopLossPct / 100);
  const atrStopDistance = atrValue ? atrValue * atrStopMultiplier : 0;
  const stopDistance = Math.max(percentStopDistance, atrStopDistance, price * 0.004);
  const capitalCapQuantity = Math.floor((capital * 0.96) / price);
  const riskQuantity = Math.floor(riskAmount / stopDistance);
  const quantity = Math.max(0, Math.min(capitalCapQuantity, riskQuantity));
  const targetDistance = Math.max(price * (takeProfitPct / 100), stopDistance * 1.4);
  const stopLossPrice = side === "SELL" ? price + stopDistance : price - stopDistance;
  const targetPrice = side === "SELL" ? price - targetDistance : price + targetDistance;
  return {
    quantity,
    riskAmount,
    stopDistance,
    stopLossPrice,
    targetPrice,
    positionValue: quantity * price,
    positionRisk: quantity * stopDistance,
  };
}

export function generateSignals({ quotes, candlesBySymbol, config, asOf = new Date() }) {
  const marketContext = computeMarketContext(quotes);
  const { niftyBias, bankNiftyBias, vix, breadth } = marketContext;
  const niftyCandles = candlesBySymbol["NIFTY 50"] ?? [];
  const marketRegime = detectMarketRegime({ niftyBias, niftyCandles, asOf, vix, breadth });
  const sectorStrength = computeSectorStrength(quotes, niftyBias);
  const sectorInfoBySector = new Map(sectorStrength.map((item) => [item.sector, item]));
  const sectorCount = sectorStrength.length;
  const tradableQuotes = quotes.filter((quote) => quote.sector !== "Index");
  const minRelativeStrengthPct = safeNumber(config.minRelativeStrengthPct, 0.05);
  const minNetRewardRisk = safeNumber(config.minNetRewardRisk, 1.2);
  const maxVix = safeNumber(config.maxVix, 28);
  const maxGapPct = safeNumber(config.maxGapPct, 3);
  const minutesNow = istMinutesOfDay(asOf);
  const inGapWindow = minutesNow > 0 && minutesNow < 10 * 60; // first 45 min after open

  const signals = tradableQuotes
    .map((quote) => {
      const candles = candlesBySymbol[quote.symbol] ?? [];
      // Session-scoped candles: VWAP, opening range, and short-term momentum
      // are intraday concepts and must not span prior trading days.
      const intradayCandles = sessionCandles(candles, asOf);
      const dayMomentumPct = quote.close ? ((quote.ltp - quote.close) / quote.close) * 100 : 0;
      const momentumPct = intradayCandles.length >= 2 ? candleMovePct(intradayCandles, 8) : dayMomentumPct;
      const relativeStrengthPct = dayMomentumPct - niftyBias;
      const signalVwap = intradayCandles.length ? vwap(intradayCandles) : vwap(candles);
      const signalAtr = atr(candles);
      const pulse = volumePulse(candles);
      const aboveVwap = quote.ltp >= signalVwap;
      const vwapDistancePct = signalVwap ? ((quote.ltp - signalVwap) / quote.ltp) * 100 : 0;
      const spreadBps = Number.isFinite(quote.spreadBps) && quote.spreadBps > 0 ? quote.spreadBps : 999;
      // Bank and NBFC names align better with Bank Nifty than with NIFTY 50.
      const sectorIndexBias = quote.sector === "Banking" || quote.sector === "Financials" ? bankNiftyBias : niftyBias;
      const selectedStrategy = selectStrategy(
        strategyScores({ quote, candles, intradayCandles, momentumPct, dayMomentumPct, aboveVwap, vwapDistancePct, pulse, niftyBias: sectorIndexBias, relativeStrengthPct, marketRegime }),
        config
      );
      const side = selectedStrategy.side ?? "BUY";
      const directionalIndexBias = side === "SELL" ? -sectorIndexBias : sectorIndexBias;
      const directionalRelativeStrength = side === "SELL" ? -relativeStrengthPct : relativeStrengthPct;
      const spreadScore = clamp((1 - spreadBps / safeNumber(config.maxSpreadBps, 18)) * 14, 0, 14);
      const strategyScore = clamp(selectedStrategy.score * 0.5, 0, 50);
      const indexScore = clamp(directionalIndexBias * 6 + 6, 0, 10);
      // Mean reversion buys weakness / sells strength, so for that family a
      // NEGATIVE directional RS is the setup, not a defect. Without this the
      // composite could structurally never reach minScore (0 trades in 42
      // backtest days). Capped lower (12) than the trend families (16).
      const relativeStrengthScore =
        selectedStrategy.mode === "mean-reversion"
          ? clamp((-directionalRelativeStrength / 0.6) * 12, 0, 12)
          : clamp((directionalRelativeStrength / 0.6) * 16, 0, 16);
      const volatilityScore = signalAtr && quote.ltp ? clamp(10 - (signalAtr / quote.ltp) * 700, 0, 10) : 5;
      const regimePass = regimeSupportsSignal(marketRegime, side, selectedStrategy.mode);
      const regimeScore = regimePass ? 10 : marketRegime.bias === "neutral" ? 6 : 0;
      const sectorInfo = sectorInfoBySector.get(quote.sector);
      const sectorRank = sectorInfo?.rank ?? 0;
      const strongSectorCutoff = Math.ceil(sectorCount / 3);
      // Sector bonus requires at least 2 members — a single-stock "sector"
      // would just be the stock confirming its own momentum.
      const sectorScore =
        sectorCount > 1 && sectorRank && (sectorInfo?.members ?? 0) >= 2
          ? side === "BUY" && sectorRank <= strongSectorCutoff
            ? 5
            : side === "SELL" && sectorRank > sectorCount - strongSectorCutoff
              ? 5
              : 0
          : 0;
      const breadthScore =
        (side === "BUY" && breadth === "positive") || (side === "SELL" && breadth === "negative") ? 3 : 0;
      const score = Math.round(
        clamp(spreadScore + strategyScore + indexScore + relativeStrengthScore + volatilityScore + regimeScore + sectorScore + breadthScore, 0, 100)
      );
      const sizing = sizePosition({ price: quote.ltp, atrValue: signalAtr, config, side, strategyMode: selectedStrategy.mode });
      const reward = estimateRoundTrip({
        side,
        entryPrice: quote.ltp,
        targetPrice: sizing.targetPrice,
        quantity: sizing.quantity,
        slippageBps: safeNumber(config.slippageBps, 8),
      });
      const netReward = reward.grossReward - reward.estimatedCharges;
      const netRewardRisk = sizing.positionRisk ? netReward / sizing.positionRisk : 0;
      const directionalMomentumPass =
        side === "SELL" ? dayMomentumPct <= -config.minMomentumPct : dayMomentumPct >= config.minMomentumPct;
      const relativeStrengthPass =
        selectedStrategy.mode === "mean-reversion" || directionalRelativeStrength >= minRelativeStrengthPct;
      const chargeAdjustedPass = netRewardRisk >= minNetRewardRisk;
      const vixPass = !Number.isFinite(vix) || vix <= maxVix;
      // Gap-open guard: a stock that gapped hard is already extended — block
      // chase entries (momentum / opening-range) during the first 45 minutes.
      const gapPct = quote.close && quote.open ? ((quote.open - quote.close) / quote.close) * 100 : 0;
      const gapSensitive = selectedStrategy.mode === "momentum" || selectedStrategy.mode === "opening-range";
      const gapPass = !gapSensitive || !inGapWindow || Math.abs(gapPct) <= maxGapPct;
      // ORB needs the full 09:15-09:45 range before a breakout means anything.
      const orbPass = selectedStrategy.mode !== "opening-range" || intradayCandles.length >= 6;
      const eligible =
        score >= config.minScore &&
        (selectedStrategy.mode === "mean-reversion" || directionalMomentumPass) &&
        relativeStrengthPass &&
        regimePass &&
        chargeAdjustedPass &&
        vixPass &&
        gapPass &&
        orbPass &&
        spreadBps <= config.maxSpreadBps &&
        quote.ltp <= config.capital * 0.98 &&
        sizing.quantity > 0;

      const gateReasons = [];
      if (score < config.minScore) gateReasons.push(`score ${score} < ${config.minScore}`);
      if (selectedStrategy.mode !== "mean-reversion" && !directionalMomentumPass) gateReasons.push("momentum gate");
      if (!relativeStrengthPass) gateReasons.push(`relative strength ${relativeStrengthPct.toFixed(2)}%`);
      if (!regimePass) gateReasons.push(`regime ${marketRegime.label}`);
      if (!chargeAdjustedPass) gateReasons.push(`net R:R ${netRewardRisk.toFixed(2)}`);
      if (!vixPass) gateReasons.push(`VIX ${vix.toFixed(1)} > ${maxVix}`);
      if (!gapPass) gateReasons.push(`gap-open ${gapPct.toFixed(1)}%`);
      if (!orbPass) gateReasons.push(`opening range forming (${intradayCandles.length}/6 candles)`);
      if (spreadBps > config.maxSpreadBps) gateReasons.push(`spread ${spreadBps.toFixed(1)} bps`);
      if (quote.ltp > config.capital * 0.98) gateReasons.push("price above capital cap");
      if (sizing.quantity <= 0) gateReasons.push("size below 1 share");

      const reasons = [
        side === "SELL" ? "short setup" : "long setup",
        selectedStrategy.label,
        selectedStrategy.setup,
        aboveVwap ? "above VWAP" : "below VWAP",
        `spread ${spreadBps.toFixed(1)} bps`,
        `RS ${relativeStrengthPct.toFixed(2)}%`,
        `regime ${marketRegime.label}`,
        `net R:R ${netRewardRisk.toFixed(2)}`,
        `volume ${pulse.toFixed(2)}x`,
        `Nifty ${niftyBias.toFixed(2)}%`,
      ];

      return {
        symbol: quote.symbol,
        name: quote.name,
        sector: quote.sector,
        source: quote.source,
        price: quote.ltp,
        score,
        strategyScore: selectedStrategy.score,
        eligible,
        gateReasons,
        confidence: clamp(score / 100, 0, 1),
        momentumPct: dayMomentumPct,
        relativeStrengthPct,
        niftyBiasPct: niftyBias,
        sectorIndexBiasPct: sectorIndexBias,
        gapPct,
        sectorRank,
        marketRegime,
        marketContext,
        vwap: signalVwap,
        atr: signalAtr,
        spreadBps,
        volume: quote.volume ?? 0,
        volumePulse: pulse,
        strategy: selectedStrategy.mode,
        setup: selectedStrategy.setup,
        stopLossPrice: sizing.stopLossPrice,
        targetPrice: sizing.targetPrice,
        positionRisk: sizing.positionRisk,
        estimatedCharges: reward.estimatedCharges,
        netReward,
        netRewardRisk,
        riskReward: sizing.positionRisk ? reward.grossReward / sizing.positionRisk : 0,
        recommendedQuantity: sizing.quantity,
        side,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Relative-strength ranking across the whole scanned universe.
  const byRelativeStrength = [...signals].sort((a, b) => b.relativeStrengthPct - a.relativeStrengthPct);
  const total = byRelativeStrength.length;
  byRelativeStrength.forEach((signal, index) => {
    signal.rsRank = index + 1;
    signal.rsPercentile = total > 1 ? Math.round(((total - 1 - index) / (total - 1)) * 100) : 50;
  });
  return signals;
}

export function agentDecision(signals, config) {
  const top = signals.find((signal) => signal.eligible) ?? signals[0];
  if (!top) {
    return {
      action: "WAIT",
      confidence: 0,
      reason: "No market data available",
    };
  }
  if (!top.eligible) {
    return {
      action: "WAIT",
      confidence: top.confidence,
      symbol: top.symbol,
      strategy: top.strategy,
      reason: top.gateReasons?.length
        ? `Best signal ${top.symbol} blocked: ${top.gateReasons.join(", ")}`
        : `Best signal ${top.symbol} scored ${top.score}, below active gates`,
    };
  }
  const side = top.side ?? "BUY";
  const sizing = sizePosition({ price: top.price, atrValue: top.atr, config, side, strategyMode: top.strategy });
  if (sizing.quantity <= 0) {
    return {
      action: "WAIT",
      confidence: top.confidence,
      symbol: top.symbol,
      strategy: top.strategy,
      reason: `Best signal ${top.symbol} passed setup but position size is below 1 share`,
    };
  }
  return {
    action: "TRADE",
    symbol: top.symbol,
    side,
    // sizePosition already caps quantity at 96% of capital — no second cap.
    quantity: sizing.quantity,
    stopLossPrice: sizing.stopLossPrice,
    targetPrice: sizing.targetPrice,
    riskAmount: sizing.positionRisk,
    strategy: top.strategy,
    confidence: top.confidence,
    score: top.score,
    reason: `${top.symbol} ${side === "SELL" ? "short" : "long"} qualifies: ${top.reasons.join(", ")}`,
  };
}
