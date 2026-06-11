function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function volumePulse(candles) {
  const latest = candles.at(-1)?.volume ?? 0;
  const average =
    candles.slice(-20).reduce((total, candle) => total + candle.volume, 0) / Math.max(1, Math.min(20, candles.length));
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

function rsi(candles, period = 14) {
  const slice = candles.slice(-period - 1);
  if (slice.length < 2) {
    return 50;
  }
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const move = slice[index].close - slice[index - 1].close;
    if (move >= 0) {
      gains += move;
    } else {
      losses += Math.abs(move);
    }
  }
  if (!losses) {
    return 100;
  }
  const relativeStrength = gains / losses;
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

function detectMarketRegime({ niftyBias = 0, niftyCandles = [] }) {
  const trendPct = niftyCandles.length >= 8 ? candleMovePct(niftyCandles, 12) : niftyBias;
  const niftyAtr = atr(niftyCandles);
  const lastClose = niftyCandles.at(-1)?.close ?? 0;
  const atrPct = lastClose ? (niftyAtr / lastClose) * 100 : 0;
  const combinedTrend = Math.abs(trendPct) > Math.abs(niftyBias) ? trendPct : niftyBias;
  const bias = combinedTrend > 0.18 ? "bullish" : combinedTrend < -0.18 ? "bearish" : "neutral";
  const volatility = atrPct > 0.35 ? "high" : atrPct > 0.18 ? "normal" : "low";
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

function strategyScores({ quote, candles, momentumPct, dayMomentumPct, aboveVwap, pulse, niftyBias, relativeStrengthPct, marketRegime }) {
  const closeValues = candles.slice(-20).map((candle) => candle.close);
  const bands = bollinger(candles);
  const signalRsi = rsi(candles);
  const range = openingRange(candles);
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

  const vwapPullback = {
    mode: "vwap-pullback",
    label: "VWAP Pullback",
    side: "BUY",
    score:
      (aboveVwap ? 20 : 0) +
      clamp(relativeStrengthPct * 14, 0, 16) +
      clamp((pulse - 0.8) * 16, 0, 20) +
      clamp(dayMomentumPct * 14, 0, 20) +
      clamp(14 - Math.abs(momentumPct) * 3, 0, 14) +
      bullishRegime,
    setup: `${aboveVwap ? "above" : "below"} VWAP, pullback pressure ${Math.abs(momentumPct).toFixed(2)}%`,
  };

  const openingBreakout = {
    mode: "opening-range",
    label: "Opening Range",
    side: "BUY",
    score:
      clamp(breakout * 42, 0, 30) +
      clamp(relativeStrengthPct * 16, 0, 18) +
      clamp((pulse - 1) * 18, 0, 22) +
      clamp(dayMomentumPct * 10, 0, 18) +
      bullishRegime +
      (quote.ltp > sma(closeValues) ? 8 : 0),
    setup: `range breakout ${breakout.toFixed(2)}%, volume ${pulse.toFixed(2)}x`,
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
      (!aboveVwap ? 20 : 0) +
      clamp(-relativeStrengthPct * 14, 0, 16) +
      clamp((pulse - 0.8) * 16, 0, 20) +
      clamp(-dayMomentumPct * 14, 0, 20) +
      clamp(14 - Math.abs(momentumPct) * 3, 0, 14) +
      bearishRegime,
    setup: `${aboveVwap ? "above" : "below"} VWAP, pullback pressure ${Math.abs(momentumPct).toFixed(2)}%`,
  };

  const openingBreakdown = {
    mode: "opening-range",
    label: "Opening Breakdown",
    side: "SELL",
    score:
      clamp(breakdown * 42, 0, 30) +
      clamp(-relativeStrengthPct * 16, 0, 18) +
      clamp((pulse - 1) * 18, 0, 22) +
      clamp(-dayMomentumPct * 10, 0, 18) +
      bearishRegime +
      (quote.ltp < sma(closeValues) ? 8 : 0),
    setup: `range breakdown ${breakdown.toFixed(2)}%, volume ${pulse.toFixed(2)}x`,
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

export function sizePosition({ price, atrValue = 0, config, side = "BUY" }) {
  const stopLossPct = safeNumber(config.stopLossPct, 0.8);
  const takeProfitPct = safeNumber(config.takeProfitPct, 1.6);
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

export function generateSignals({ quotes, candlesBySymbol, config }) {
  const nifty = quotes.find((quote) => quote.symbol === "NIFTY 50");
  const niftyBias = nifty ? ((nifty.ltp - nifty.close) / nifty.close) * 100 : 0;
  const niftyCandles = candlesBySymbol["NIFTY 50"] ?? [];
  const marketRegime = detectMarketRegime({ niftyBias, niftyCandles });
  const tradableQuotes = quotes.filter((quote) => quote.sector !== "Index");
  const minRelativeStrengthPct = safeNumber(config.minRelativeStrengthPct, 0.05);
  const minNetRewardRisk = safeNumber(config.minNetRewardRisk, 1.2);

  return tradableQuotes
    .map((quote) => {
      const candles = candlesBySymbol[quote.symbol] ?? [];
      const lastClose = candles.at(-1)?.close ?? quote.close;
      const firstClose = candles.at(-8)?.close ?? quote.close;
      const momentumPct = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
      const dayMomentumPct = quote.close ? ((quote.ltp - quote.close) / quote.close) * 100 : 0;
      const relativeStrengthPct = dayMomentumPct - niftyBias;
      const signalVwap = vwap(candles);
      const signalAtr = atr(candles);
      const pulse = volumePulse(candles);
      const aboveVwap = quote.ltp >= signalVwap;
      const spreadBps = Number.isFinite(quote.spreadBps) && quote.spreadBps > 0 ? quote.spreadBps : 999;
      const selectedStrategy = selectStrategy(
        strategyScores({ quote, candles, momentumPct, dayMomentumPct, aboveVwap, pulse, niftyBias, relativeStrengthPct, marketRegime }),
        config
      );
      const side = selectedStrategy.side ?? "BUY";
      const directionalNiftyBias = side === "SELL" ? -niftyBias : niftyBias;
      const directionalRelativeStrength = side === "SELL" ? -relativeStrengthPct : relativeStrengthPct;
      const spreadScore = clamp((1 - spreadBps / safeNumber(config.maxSpreadBps, 18)) * 14, 0, 14);
      const strategyScore = clamp(selectedStrategy.score * 0.5, 0, 50);
      const indexScore = clamp(directionalNiftyBias * 6 + 6, 0, 10);
      const relativeStrengthScore = clamp((directionalRelativeStrength / 0.6) * 16, 0, 16);
      const volatilityScore = signalAtr && quote.ltp ? clamp(10 - (signalAtr / quote.ltp) * 700, 0, 10) : 5;
      const regimePass = regimeSupportsSignal(marketRegime, side, selectedStrategy.mode);
      const regimeScore = regimePass ? 10 : marketRegime.bias === "neutral" ? 6 : 0;
      const score = Math.round(clamp(spreadScore + strategyScore + indexScore + relativeStrengthScore + volatilityScore + regimeScore, 0, 100));
      const sizing = sizePosition({ price: quote.ltp, atrValue: signalAtr, config, side });
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
      const eligible =
        score >= config.minScore &&
        (selectedStrategy.mode === "mean-reversion" || directionalMomentumPass) &&
        relativeStrengthPass &&
        regimePass &&
        chargeAdjustedPass &&
        spreadBps <= config.maxSpreadBps &&
        quote.ltp <= config.capital * 0.98 &&
        sizing.quantity > 0;

      const gateReasons = [];
      if (score < config.minScore) gateReasons.push(`score ${score} < ${config.minScore}`);
      if (selectedStrategy.mode !== "mean-reversion" && !directionalMomentumPass) gateReasons.push("momentum gate");
      if (!relativeStrengthPass) gateReasons.push(`relative strength ${relativeStrengthPct.toFixed(2)}%`);
      if (!regimePass) gateReasons.push(`regime ${marketRegime.label}`);
      if (!chargeAdjustedPass) gateReasons.push(`net R:R ${netRewardRisk.toFixed(2)}`);
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
        marketRegime,
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
  const maxPositionValue = config.capital * 0.96;
  const side = top.side ?? "BUY";
  const sizing = sizePosition({ price: top.price, atrValue: top.atr, config, side });
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
    quantity: Math.min(sizing.quantity, Math.max(1, Math.floor(maxPositionValue / top.price))),
    stopLossPrice: sizing.stopLossPrice,
    targetPrice: sizing.targetPrice,
    riskAmount: sizing.positionRisk,
    strategy: top.strategy,
    confidence: top.confidence,
    score: top.score,
    reason: `${top.symbol} ${side === "SELL" ? "short" : "long"} qualifies: ${top.reasons.join(", ")}`,
  };
}
