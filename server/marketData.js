import { appendEvent, readJson, saveJson } from "./database.js";
import { instrumentKey, marketContextSymbols, watchlist } from "./watchlist.js";

const instrumentCacheName = "instrument-cache.json";
const quoteState = new Map();

function seededBasePrice(symbol) {
  const prices = {
    RELIANCE: 2872.5,
    HDFCBANK: 1641.8,
    ICICIBANK: 1126.45,
    INFY: 1478.7,
    TCS: 3916.4,
    SBIN: 827.25,
    AXISBANK: 1178.6,
    KOTAKBANK: 1764.2,
    HCLTECH: 1545.6,
    TECHM: 1490.3,
    LT: 3588.25,
    BHARTIARTL: 1398.1,
    MARUTI: 12442.6,
    EICHERMOT: 5418.5,
    "M&M": 2876.1,
    TITAN: 3479.3,
    HINDUNILVR: 2392.8,
    ITC: 432.6,
    ULTRACEMCO: 10924.9,
    TATASTEEL: 152.3,
    JSWSTEEL: 938.7,
    SUNPHARMA: 1764.9,
    CIPLA: 1496.2,
    BAJFINANCE: 6890.5,
    NTPC: 354.8,
    ONGC: 246.7,
    "NIFTY 50": 23150,
    "NIFTY BANK": 49650,
    "INDIA VIX": 14.2,
  };
  return prices[symbol] ?? 1000;
}

function mockQuote(item) {
  const key = instrumentKey(item);
  const previous = quoteState.get(key) ?? {
    ltp: seededBasePrice(item.tradingsymbol),
    close: seededBasePrice(item.tradingsymbol) * (0.996 + Math.random() * 0.008),
    volume: 120000 + Math.floor(Math.random() * 600000),
  };
  const volatility = item.sector === "Index" ? 0.07 : 0.18;
  const next = Math.max(1, previous.ltp * (1 + ((Math.random() - 0.48) * volatility) / 100));
  const spreadBps = item.sector === "Index" ? 2 : 6 + Math.random() * 12;
  const bestBid = next * (1 - spreadBps / 20000);
  const bestAsk = next * (1 + spreadBps / 20000);
  const quote = {
    instrument: key,
    exchange: item.exchange,
    symbol: item.tradingsymbol,
    name: item.name,
    sector: item.sector,
    source: "simulator",
    ltp: next,
    open: previous.close * 1.001,
    high: Math.max(previous.ltp, next) * 1.004,
    low: Math.min(previous.ltp, next) * 0.996,
    close: previous.close,
    volume: previous.volume + Math.floor(Math.random() * 8000),
    bestBid,
    bestAsk,
    spreadBps,
    lastTradeTime: new Date().toISOString(),
  };
  quoteState.set(key, { ltp: quote.ltp, close: quote.close, volume: quote.volume });
  return quote;
}

function normalizeKiteQuote(instrument, item, payload) {
  const depthBuy = payload.depth?.buy?.[0];
  const depthSell = payload.depth?.sell?.[0];
  const rawBestBid = depthBuy?.price;
  const rawBestAsk = depthSell?.price;
  const rawSpreadBps = payload.last_price && rawBestBid && rawBestAsk ? ((rawBestAsk - rawBestBid) / payload.last_price) * 10000 : 999;
  const validDepth =
    Number.isFinite(rawBestBid) &&
    Number.isFinite(rawBestAsk) &&
    rawBestBid > 0 &&
    rawBestAsk > 0 &&
    rawBestAsk >= rawBestBid &&
    Number.isFinite(rawSpreadBps) &&
    rawSpreadBps > 0;
  const bestBid = validDepth ? rawBestBid : payload.last_price;
  const bestAsk = validDepth ? rawBestAsk : payload.last_price;
  const spreadBps = validDepth ? rawSpreadBps : 999;
  return {
    instrument,
    exchange: item.exchange,
    symbol: item.tradingsymbol,
    name: item.name,
    sector: item.sector,
    source: "kite-rest",
    instrumentToken: payload.instrument_token,
    ltp: payload.last_price,
    open: payload.ohlc?.open ?? payload.last_price,
    high: payload.ohlc?.high ?? payload.last_price,
    low: payload.ohlc?.low ?? payload.last_price,
    close: payload.ohlc?.close ?? payload.last_price,
    volume: payload.volume ?? 0,
    bestBid,
    bestAsk,
    spreadBps,
    lastTradeTime: payload.last_trade_time ?? new Date().toISOString(),
  };
}

function hasUsableSpread(quote) {
  return Number.isFinite(quote?.spreadBps) && quote.spreadBps > 0 && quote.spreadBps < 999;
}

function mergeStreamQuotes(items, streamQuotes, restQuotes) {
  const bySymbol = new Map(restQuotes.map((quote) => [quote.symbol, quote]));
  for (const quote of streamQuotes) {
    const previous = bySymbol.get(quote.symbol) ?? {};
    const canUseRestDepth = previous.source === "kite-rest" && hasUsableSpread(previous);
    const streamDepth = hasUsableSpread(quote)
      ? {
          bestBid: quote.bestBid,
          bestAsk: quote.bestAsk,
          spreadBps: quote.spreadBps,
        }
      : canUseRestDepth
        ? {
            bestBid: previous.bestBid,
            bestAsk: previous.bestAsk,
            spreadBps: previous.spreadBps,
          }
        : {
            bestBid: quote.bestBid,
            bestAsk: quote.bestAsk,
            spreadBps: quote.spreadBps,
          };
    bySymbol.set(quote.symbol, {
      ...previous,
      ...quote,
      ...streamDepth,
    });
  }
  return items.map((item) => bySymbol.get(item.tradingsymbol)).filter(Boolean);
}

function realQuotesFromRest(items, data) {
  const quotes = [];
  const missing = [];
  for (const item of items) {
    const key = instrumentKey(item);
    if (data[key]) {
      quotes.push(normalizeKiteQuote(key, item, data[key]));
    } else {
      missing.push(item.tradingsymbol);
    }
  }
  return { quotes, missing };
}

function missingFromQuotes(items, quotes) {
  const present = new Set(quotes.map((quote) => quote.symbol));
  return items.map((item) => item.tradingsymbol).filter((symbol) => !present.has(symbol));
}

export async function getQuoteSnapshot(kiteClient, tokenReady, marketStream = null) {
  const items = [...watchlist, ...marketContextSymbols];
  if (tokenReady) {
    // Token ready: only real Kite data may be returned. Symbols without real
    // quotes are dropped and reported in `missing` — never backfilled with the
    // simulator, so paper evidence cannot be contaminated by fake prices.
    try {
      if (marketStream) {
        const cache = readJson(instrumentCacheName, { instruments: {} });
        if (Object.keys(cache.instruments ?? {}).length) {
          marketStream.start(cache.instruments);
          const streamQuotes = marketStream.quotes(items);
          if (streamQuotes.length >= Math.min(4, items.length)) {
            const needsDepthFallback = streamQuotes.some((quote) => quote.sector !== "Index" && !hasUsableSpread(quote));
            if (needsDepthFallback) {
              try {
                const instruments = items.map(instrumentKey);
                const data = await kiteClient.quote(instruments);
                const rest = realQuotesFromRest(items, data);
                const merged = mergeStreamQuotes(items, streamQuotes, rest.quotes);
                appendEvent("market.quotes", { source: "kite-ws-rest-depth", count: merged.length });
                return { source: "kite-ws-rest-depth", quotes: merged, missing: missingFromQuotes(items, merged) };
              } catch (error) {
                appendEvent("market.depth_fallback_error", {
                  message: error instanceof Error ? error.message : "depth fallback error",
                });
              }
            }
            const merged = mergeStreamQuotes(items, streamQuotes, []);
            appendEvent("market.quotes", { source: "kite-ws", count: merged.length });
            return { source: "kite-ws", quotes: merged, missing: missingFromQuotes(items, merged) };
          }
        }
      }
      const instruments = items.map(instrumentKey);
      const data = await kiteClient.quote(instruments);
      const { quotes, missing } = realQuotesFromRest(items, data);
      if (missing.length) {
        appendEvent("market.missing_quotes", { source: "kite-rest", missing });
      }
      if (marketStream) {
        const cache = readJson(instrumentCacheName, { instruments: {} });
        if (!Object.keys(cache.instruments ?? {}).length) {
          syncInstrumentCache(kiteClient).then((instrumentsBySymbol) => marketStream.start(instrumentsBySymbol)).catch(() => undefined);
        } else {
          marketStream.start(cache.instruments);
        }
      }
      appendEvent("market.quotes", { source: "kite-rest", count: quotes.length });
      return { source: "kite-rest", quotes, missing };
    } catch (error) {
      appendEvent("market.error", { message: error instanceof Error ? error.message : "quote error" });
      // Token is ready but Kite failed: return no quotes rather than fake
      // ones. The strategy layer treats an empty snapshot as WAIT.
      return { source: "kite-error", quotes: [], missing: items.map((item) => item.tradingsymbol) };
    }
  }

  const quotes = items.map(mockQuote);
  return { source: "simulator", quotes, missing: [] };
}

function parseInstrumentCsv(csv) {
  const [headerLine, ...rows] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return rows.map((row) => {
    const values = row.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

export async function syncInstrumentCache(kiteClient) {
  const csv = await kiteClient.instruments("NSE");
  const rows = parseInstrumentCsv(csv);
  const wanted = new Set([...watchlist, ...marketContextSymbols].map((item) => item.tradingsymbol));
  const mapped = rows
    .filter((row) => wanted.has(row.tradingsymbol))
    .reduce((acc, row) => {
      acc[row.tradingsymbol] = {
        instrumentToken: Number(row.instrument_token),
        exchangeToken: Number(row.exchange_token),
        name: row.name,
      };
      return acc;
    }, {});
  saveJson(instrumentCacheName, { updatedAt: new Date().toISOString(), instruments: mapped });
  appendEvent("market.instruments", { count: Object.keys(mapped).length });
  return mapped;
}

function mockCandles(symbol, days = 5) {
  const candles = [];
  let price = seededBasePrice(symbol);
  const total = Math.max(20, Math.min(300, days * 75));
  for (let index = 0; index < total; index += 1) {
    const open = price;
    const move = (Math.random() - 0.48) * price * 0.0035;
    const close = Math.max(1, open + move);
    const high = Math.max(open, close) * (1 + Math.random() * 0.0018);
    const low = Math.min(open, close) * (1 - Math.random() * 0.0018);
    const volume = 20000 + Math.floor(Math.random() * 110000);
    price = close;
    candles.push({
      time: new Date(Date.now() - (total - index) * 5 * 60 * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return candles;
}

// 5-minute candles only change every 5 minutes; the strategy endpoint is
// polled every few seconds. Cache per symbol to avoid hammering the Kite
// historical API (350ms rate limit x 9 symbols = seconds per signals call).
const candleCache = new Map();
const CANDLE_CACHE_TTL_MS = 3 * 60 * 1000;

export async function getCandles(kiteClient, tokenReady, symbol, interval = "5minute", days = 5) {
  if (tokenReady) {
    const cacheKey = `${symbol}:${interval}:${days}`;
    const cached = candleCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CANDLE_CACHE_TTL_MS) {
      return cached.payload;
    }
    const cache = readJson(instrumentCacheName, { instruments: {} });
    let token = cache.instruments?.[symbol]?.instrumentToken;
    if (!token) {
      const synced = await syncInstrumentCache(kiteClient);
      token = synced[symbol]?.instrumentToken;
    }
    if (token) {
      const to = new Date();
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const format = (date) => date.toISOString().slice(0, 19).replace("T", " ");
      const data = await kiteClient.historical(token, interval, format(from), format(to));
      const payload = {
        source: "kite-historical",
        symbol,
        candles: data.candles.map((row) => ({
          time: row[0],
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[5],
        })),
      };
      candleCache.set(cacheKey, { at: Date.now(), payload });
      return payload;
    }
    // Token ready but no instrument token resolved: return no candles rather
    // than simulated ones, so real-data sessions never mix in fake history.
    return { source: "kite-missing-instrument", symbol, candles: [] };
  }
  return { source: "simulator", symbol, candles: mockCandles(symbol, days) };
}

export async function getCandlesForWatchlist(kiteClient, tokenReady, symbols, days = 5) {
  const result = {};
  for (const symbol of symbols) {
    try {
      result[symbol] = (await getCandles(kiteClient, tokenReady, symbol, "5minute", days)).candles;
    } catch (error) {
      // One symbol failing must not take down the whole signals endpoint.
      // Serve stale cache if available, otherwise no candles for this symbol.
      const stale = candleCache.get(`${symbol}:5minute:${days}`);
      result[symbol] = stale?.payload.candles ?? [];
      appendEvent("market.candles_error", {
        symbol,
        message: error instanceof Error ? error.message : "candles error",
        servedStaleCache: Boolean(stale),
      });
    }
  }
  return result;
}
