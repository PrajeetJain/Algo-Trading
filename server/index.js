import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { URL } from "node:url";
import { appendEvent, readEvents, readJson, saveJson } from "./database.js";
import { createBotEngine } from "./botEngine.js";
import { createKiteClient } from "./kiteClient.js";
import { createKiteMarketStream } from "./marketStream.js";
import { getMarketSession } from "./marketCalendar.js";
import { getCandles, getCandlesForWatchlist, getQuoteSnapshot, syncInstrumentCache } from "./marketData.js";
import { liveOrder, orderEvents, paperOrder, tradeHistory } from "./orders.js";
import { runBacktest } from "./backtester.js";
import { latestWalkForward, replayBacktest, syncHistoricalCandles, walkForward, walkForwardCsv } from "./backtestEngine.js";
import { candleCoverage } from "./candleStore.js";
import { performanceAnalytics, tradeQuality } from "./analytics.js";
import { agentDecision, generateSignals } from "./strategy.js";
import { getRiskState, setKillSwitch } from "./riskGuard.js";
import { evidenceReport } from "./verdict.js";
import { notifierStatus } from "./notifier.js";
import { instrumentKey, watchlist } from "./watchlist.js";

loadEnvFile();

// PORT (set by hosts/preview tools) takes precedence over .env's API_PORT.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
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

// targetPct/maxLossPct rationale: a full stop-out costs ~1.28x the nominal
// risk once slippage and charges land (~Rs 160 on a Rs 125 risk), so the
// daily loss cap must leave room for maxTrades full stops (2 x 160 = 320 <
// 375). The daily target is set so one full winner plus a small second win
// can actually reach it (a perfect 2R winner nets ~Rs 250).
const defaultConfig = {
  capital: 200000,
  targetPct: 0.75,
  maxLossPct: 0.75,
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
  maxVix: 28,
  maxGapPct: 3,
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

const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://127.0.0.1:5175";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

// Serve the built frontend (dist/) so a VPS deployment is a single process:
// `npm run build` once, then `npm run api` serves both UI and API.
const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(response, pathname) {
  const distDir = join(process.cwd(), "dist");
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(distDir, requested.replaceAll("..", ""));
  const fallback = join(distDir, "index.html");
  const target = existsSync(filePath) && extname(filePath) ? filePath : fallback;
  if (!existsSync(target)) {
    sendJson(response, 404, { error: "Frontend build not found. Run: npm run build" });
    return;
  }
  response.writeHead(200, { "Content-Type": staticTypes[extname(target)] ?? "application/octet-stream" });
  response.end(readFileSync(target));
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
    maxVix: Number(url.searchParams.get("maxVix") ?? defaultConfig.maxVix),
    maxGapPct: Number(url.searchParams.get("maxGapPct") ?? defaultConfig.maxGapPct),
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
    notifications: notifierStatus(),
    paperBot: botEngine
      ? (() => {
          const view = botEngine.getStateView();
          return {
            status: view.status,
            lastTickAt: view.heartbeat.lastTickAt,
            healthy: view.heartbeat.healthy,
            openPositions: view.positions.length,
          };
        })()
      : null,
  };
}

// The signals endpoint is polled by both the UI (12s) and the bot loop (7s).
// Throttle snapshot logging so analytics sample counts reflect time, not
// poll frequency, and events.jsonl does not bloat with duplicates.
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 1000;
let lastSnapshotAtMs = 0;

async function strategyPayload(config) {
  const market = await getQuoteSnapshot(kiteClient, tokenReady(), marketStream);
  latestQuotes = market.quotes;
  const symbols = [...watchlist.map((item) => item.tradingsymbol).slice(0, 16), "NIFTY 50"];
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
    dataQuality: {
      missingQuotes: market.missing ?? [],
      quoteCount: market.quotes.length,
    },
    decision,
    signals,
  };
  // Always log TRADE decisions (rare and important); throttle the rest.
  if (decision.action !== "TRADE" && Date.now() - lastSnapshotAtMs < SNAPSHOT_MIN_INTERVAL_MS) {
    return payload;
  }
  lastSnapshotAtMs = Date.now();
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

// The paper bot runtime lives here on the server: it survives browser
// refreshes and laptop tab closures, and resumes open positions after a
// server restart (positions are durable in SQLite).
const botEngine = createBotEngine({ getStrategy: (config) => strategyPayload(config) });
const BOT_TICK_MS = 5000;
setInterval(() => {
  botEngine.tick().catch((error) => {
    appendEvent("bot.tick_error", { message: error instanceof Error ? error.message : "tick error" });
  });
}, BOT_TICK_MS);

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
      const symbols = [...watchlist.map((item) => item.tradingsymbol).slice(0, 16), "NIFTY 50"];
      const candlesBySymbol = await getCandlesForWatchlist(kiteClient, tokenReady(), symbols, Number(body.days ?? 10));
      sendJson(response, 200, await runBacktest({ config, quotes: market.quotes, candlesBySymbol }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backtest/latest") {
      sendJson(response, 200, readJson("latest-backtest.json", null));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/backtest/sync-candles") {
      const body = await readBody(request);
      const result = await syncHistoricalCandles({
        kiteClient,
        tokenReady: tokenReady(),
        days: Number(body.days ?? 60),
        async getInstrumentToken(symbol) {
          const cache = readJson("instrument-cache.json", { instruments: {} });
          let token = cache.instruments?.[symbol]?.instrumentToken;
          if (!token) {
            const synced = await syncInstrumentCache(kiteClient);
            token = synced[symbol]?.instrumentToken;
          }
          return token ?? null;
        },
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backtest/candle-coverage") {
      sendJson(response, 200, candleCoverage());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/backtest/replay") {
      const body = await readBody(request);
      const config = { ...defaultConfig, ...(body.config ?? {}) };
      sendJson(response, 200, replayBacktest({ config, days: body.days ?? null }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/backtest/walk-forward") {
      const body = await readBody(request);
      const baseConfig = { ...defaultConfig, ...(body.config ?? {}) };
      sendJson(
        response,
        200,
        walkForward({
          baseConfig,
          gridSpec: body.gridSpec ?? undefined,
          trainDays: Number(body.trainDays ?? 10),
          testDays: Number(body.testDays ?? 5),
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backtest/walk-forward/latest") {
      sendJson(response, 200, latestWalkForward());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backtest/walk-forward/latest.csv") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "http://127.0.0.1:5175",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=walk-forward.csv",
      });
      response.end(walkForwardCsv());
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

    if (request.method === "GET" && url.pathname === "/api/verdict") {
      sendJson(response, 200, evidenceReport({ capital: Number(url.searchParams.get("capital") ?? defaultConfig.capital) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/analytics/trade-quality") {
      sendJson(
        response,
        200,
        tradeQuality({
          capital: Number(url.searchParams.get("capital") ?? defaultConfig.capital),
          limit: Number(url.searchParams.get("limit") ?? 200),
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

    if (request.method === "GET" && url.pathname === "/api/paper/state") {
      sendJson(response, 200, botEngine.getStateView());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/paper/positions") {
      sendJson(response, 200, { positions: botEngine.getStateView().positions });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/paper/start") {
      const body = await readBody(request);
      const result = botEngine.start(body.config ?? null);
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/paper/pause") {
      const result = botEngine.pause();
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/paper/close-day") {
      const result = botEngine.closeDay();
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/paper/config") {
      const body = await readBody(request);
      sendJson(response, 200, { ok: true, config: botEngine.setConfig(body.config ?? {}) });
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

    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      serveStatic(response, url.pathname);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected server error" });
  }
});

const host = process.env.API_HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Aindra API listening on http://${host}:${port}`);
});
