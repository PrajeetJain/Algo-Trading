import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { URL } from "node:url";
import { appendEvent, readEvents, readJson, saveJson } from "./database.js";
import { createKiteClient } from "./kiteClient.js";
import { createKiteMarketStream } from "./marketStream.js";
import { getMarketSession } from "./marketCalendar.js";
import { getCandles, getCandlesForWatchlist, getQuoteSnapshot, syncInstrumentCache } from "./marketData.js";
import { liveOrder, orderEvents, paperOrder, tradeHistory } from "./orders.js";
import { runBacktest } from "./backtester.js";
import { performanceAnalytics } from "./analytics.js";
import { agentDecision, generateSignals } from "./strategy.js";
import { getRiskState, setKillSwitch } from "./riskGuard.js";
import { instrumentKey, watchlist } from "./watchlist.js";

loadEnvFile();

const port = Number(process.env.API_PORT ?? 8787);
const kiteApiKey = process.env.KITE_API_KEY ?? "";
const kiteApiSecret = process.env.KITE_API_SECRET ?? "";
const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === "true";

let kiteAccessToken = "";
let kiteProfile = null;
let latestQuotes = [];

const savedSession = readJson("kite-session.json", null);
if (savedSession && isSessionUsable(savedSession)) {
  kiteAccessToken = savedSession.accessToken ?? "";
  kiteProfile = savedSession.profile ?? null;
}

const defaultConfig = {
  capital: 50000,
  targetPct: 1,
  maxLossPct: 0.5,
  maxTrades: 2,
  slippageBps: 8,
  minScore: 70,
  minMomentumPct: 0.1,
  maxSpreadBps: 18,
  riskPerTradePct: 0.25,
  stopLossPct: 0.8,
  takeProfitPct: 1.6,
  atrStopMultiplier: 1.5,
  minRelativeStrengthPct: 0.05,
  minNetRewardRisk: 1.2,
  strategyMode: "hybrid",
};

const kiteClient = createKiteClient({
  apiKey: kiteApiKey,
  apiSecret: kiteApiSecret,
  getAccessToken: () => kiteAccessToken,
  setSession(accessToken, profile) {
    kiteAccessToken = accessToken;
    kiteProfile = profile;
    saveJson("kite-session.json", {
      accessToken,
      profile,
      connectedAt: new Date().toISOString(),
    });
  },
});
const marketStream = createKiteMarketStream({ kiteClient });

function isSessionUsable(session) {
  if (!session?.accessToken || !session.connectedAt) {
    return false;
  }
  const now = new Date();
  const connected = new Date(session.connectedAt);
  const expiry = new Date(connected);
  expiry.setDate(expiry.getDate() + 1);
  expiry.setHours(6, 0, 0, 0);
  return now < expiry;
}

function loadEnvFile() {
  if (!existsSync(".env")) {
    return;
  }

  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5175",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function readConfigFromUrl(url) {
  return {
    ...defaultConfig,
    capital: Number(url.searchParams.get("capital") ?? defaultConfig.capital),
    targetPct: Number(url.searchParams.get("targetPct") ?? defaultConfig.targetPct),
    maxLossPct: Number(url.searchParams.get("maxLossPct") ?? defaultConfig.maxLossPct),
    maxTrades: Number(url.searchParams.get("maxTrades") ?? defaultConfig.maxTrades),
    slippageBps: Number(url.searchParams.get("slippageBps") ?? defaultConfig.slippageBps),
    minScore: Number(url.searchParams.get("minScore") ?? defaultConfig.minScore),
    minMomentumPct: Number(url.searchParams.get("minMomentumPct") ?? defaultConfig.minMomentumPct),
    maxSpreadBps: Number(url.searchParams.get("maxSpreadBps") ?? defaultConfig.maxSpreadBps),
    riskPerTradePct: Number(url.searchParams.get("riskPerTradePct") ?? defaultConfig.riskPerTradePct),
    stopLossPct: Number(url.searchParams.get("stopLossPct") ?? defaultConfig.stopLossPct),
    takeProfitPct: Number(url.searchParams.get("takeProfitPct") ?? defaultConfig.takeProfitPct),
    atrStopMultiplier: Number(url.searchParams.get("atrStopMultiplier") ?? defaultConfig.atrStopMultiplier),
    minRelativeStrengthPct: Number(url.searchParams.get("minRelativeStrengthPct") ?? defaultConfig.minRelativeStrengthPct),
    minNetRewardRisk: Number(url.searchParams.get("minNetRewardRisk") ?? defaultConfig.minNetRewardRisk),
    strategyMode: url.searchParams.get("strategyMode") ?? defaultConfig.strategyMode,
  };
}

function tokenReady() {
  return Boolean(kiteAccessToken);
}

function brokerStatus() {
  const ready = tokenReady();
  const stream = marketStream.status();
  return {
    broker: "Zerodha Kite",
    mode: "paper",
    apiConfigured: Boolean(kiteApiKey && kiteApiSecret),
    liveTradingEnabled,
    tokenState: ready ? "ready" : "missing",
    dataSource: ready ? (stream.state === "open" && !stream.stale ? "kite-ws" : "kite-rest") : "simulator",
    orderRoute: ready && liveTradingEnabled ? "kite" : "simulator",
    liveOrders: ready && liveTradingEnabled ? "armed" : "locked",
    serverTime: new Date().toISOString(),
    profile: kiteProfile,
    stream,
    rateLimits: kiteClient.rateLimits(),
  };
}

async function strategyPayload(config) {
  const market = await getQuoteSnapshot(kiteClient, tokenReady(), marketStream);
  latestQuotes = market.quotes;
  const symbols = [...watchlist.map((item) => item.tradingsymbol).slice(0, 8), "NIFTY 50"];
  const candlesBySymbol = await getCandlesForWatchlist(kiteClient, tokenReady(), symbols, 3);
  const signals = generateSignals({ quotes: market.quotes, candlesBySymbol, config });
  const session = getMarketSession();
  const decision = session.freshEntriesAllowed
    ? agentDecision(signals, config)
    : {
        action: "WAIT",
        confidence: signals[0]?.confidence ?? 0,
        symbol: signals[0]?.symbol,
        reason: `Market calendar guard: ${session.reason}. Fresh entries are blocked.`,
      };
  const payload = {
    source: market.source,
    generatedAt: new Date().toISOString(),
    session,
    marketRegime: signals[0]?.marketRegime ?? null,
    decision,
    signals,
  };
  appendEvent("signals.snapshot", {
    source: payload.source,
    generatedAt: payload.generatedAt,
    session: {
      phase: session.phase,
      freshEntriesAllowed: session.freshEntriesAllowed,
      reason: session.reason,
    },
    marketRegime: payload.marketRegime,
    decision,
    signals: signals.map((signal) => ({
      symbol: signal.symbol,
      sector: signal.sector,
      side: signal.side,
      strategy: signal.strategy,
      score: signal.score,
      strategyScore: signal.strategyScore,
      eligible: signal.eligible,
      gateReasons: signal.gateReasons,
      momentumPct: signal.momentumPct,
      relativeStrengthPct: signal.relativeStrengthPct,
      niftyBiasPct: signal.niftyBiasPct,
      marketRegime: signal.marketRegime,
      spreadBps: signal.spreadBps,
      volumePulse: signal.volumePulse,
      riskReward: signal.riskReward,
      netRewardRisk: signal.netRewardRisk,
      estimatedCharges: signal.estimatedCharges,
      recommendedQuantity: signal.recommendedQuantity,
    })),
  });
  return payload;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "aindra-api",
        features: [
          "kite-auth",
          "market-data",
          "kite-websocket-stream",
          "live-paper-signals",
          "strategy-agent",
          "backtesting",
          "risk-guard",
          "performance-analytics",
          "signal-logging",
          "paper-orders",
          "locked-live-orders",
          "jsonl-database",
          "api-rate-limiter",
          "market-calendar",
        ],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/broker/status") {
      sendJson(response, 200, brokerStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/calendar") {
      sendJson(response, 200, getMarketSession());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/stream/status") {
      sendJson(response, 200, marketStream.status());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/broker/zerodha/login-url") {
      sendJson(response, 200, { loginUrl: kiteClient.loginUrl() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/broker/zerodha/session") {
      const body = await readBody(request);
      if (typeof body.requestToken !== "string" || !body.requestToken.trim()) {
        sendJson(response, 400, { error: "requestToken is required" });
        return;
      }
      await kiteClient.createSession(body.requestToken.trim());
      syncInstrumentCache(kiteClient).then((instruments) => marketStream.start(instruments)).catch(() => undefined);
      sendJson(response, 200, brokerStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/broker/zerodha/sync-instruments") {
      const instruments = await syncInstrumentCache(kiteClient);
      marketStream.start(instruments);
      sendJson(response, 200, { count: Object.keys(instruments).length, instruments });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/watchlist") {
      sendJson(response, 200, { watchlist, instruments: watchlist.map(instrumentKey) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/quotes") {
      const market = await getQuoteSnapshot(kiteClient, tokenReady(), marketStream);
      latestQuotes = market.quotes;
      sendJson(response, 200, market);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/candles") {
      const symbol = url.searchParams.get("symbol") ?? "INFY";
      const interval = url.searchParams.get("interval") ?? "5minute";
      const days = Number(url.searchParams.get("days") ?? 5);
      sendJson(response, 200, await getCandles(kiteClient, tokenReady(), symbol, interval, days));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/strategy/signals") {
      sendJson(response, 200, await strategyPayload(readConfigFromUrl(url)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/backtest/run") {
      const body = await readBody(request);
      const config = { ...defaultConfig, ...(body.config ?? {}) };
      const market = latestQuotes.length ? { quotes: latestQuotes } : await getQuoteSnapshot(kiteClient, tokenReady(), marketStream);
      const symbols = [...watchlist.map((item) => item.tradingsymbol).slice(0, 8), "NIFTY 50"];
      const candlesBySymbol = await getCandlesForWatchlist(kiteClient, tokenReady(), symbols, Number(body.days ?? 10));
      sendJson(response, 200, await runBacktest({ config, quotes: market.quotes, candlesBySymbol }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backtest/latest") {
      sendJson(response, 200, readJson("latest-backtest.json", null));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/analytics/performance") {
      sendJson(
        response,
        200,
        performanceAnalytics({
          capital: Number(url.searchParams.get("capital") ?? defaultConfig.capital),
          limit: Number(url.searchParams.get("limit") ?? 50000),
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/risk/state") {
      sendJson(response, 200, getRiskState(readConfigFromUrl(url)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/risk/kill-switch") {
      const body = await readBody(request);
      setKillSwitch(Boolean(body.active), body.reason ?? "manual");
      sendJson(response, 200, getRiskState(defaultConfig));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/orders/paper") {
      const body = await readBody(request);
      const quote = latestQuotes.find((item) => item.symbol === body.tradingsymbol);
      sendJson(
        response,
        200,
        paperOrder(body, quote, {
          config: { ...defaultConfig, ...(body.config ?? {}) },
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/orders/live") {
      const body = await readBody(request);
      const quote = latestQuotes.find((item) => item.symbol === body.tradingsymbol);
      const enrichedOrder = {
        ...body,
        estimatedPrice: body.estimatedPrice ?? quote?.ltp,
      };
      sendJson(
        response,
        200,
        await liveOrder(kiteClient, enrichedOrder, {
          config: { ...defaultConfig, ...(body.config ?? {}) },
          tokenReady: tokenReady(),
          liveTradingEnabled,
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/orders") {
      sendJson(response, 200, { events: orderEvents(Number(url.searchParams.get("limit") ?? 100)) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trade-history") {
      sendJson(
        response,
        200,
        tradeHistory({
          capital: Number(url.searchParams.get("capital") ?? defaultConfig.capital),
          limit: Number(url.searchParams.get("limit") ?? 50000),
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      sendJson(response, 200, { events: readEvents(Number(url.searchParams.get("limit") ?? 100), url.searchParams.get("type") ?? "") });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Aindra API listening on http://127.0.0.1:${port}`);
});
