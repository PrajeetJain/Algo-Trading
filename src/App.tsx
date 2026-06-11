import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  CircleDollarSign,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileClock,
  FlaskConical,
  Gauge,
  KeyRound,
  LineChart,
  Moon,
  Pause,
  Play,
  PlugZap,
  Radar,
  RefreshCw,
  Scale,
  ShieldCheck,
  Square,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyticsPayload,
  BacktestResult,
  BrokerStatus,
  CandlePayload,
  Config,
  DailyReport,
  PaperEngineState,
  RiskState,
  Simulation,
  StrategyPayload,
  Theme,
  Toast,
  TradeHistoryPayload,
  TradeQualityPayload,
  VerdictPayload,
} from "./types";
import { CONFIG_STORAGE_KEY, REPORTS_STORAGE_KEY, SIM_STORAGE_KEY } from "./types";
import {
  clamp,
  configQuery,
  downloadCsv,
  formatCurrency,
  formatNextOpen,
  formatNumber,
  nowLabel,
  sourceLabel,
  statusLabel,
  strategyLabel,
  toCsv,
  todayKey,
} from "./lib/format";
import {
  applyBackendSignals,
  applyMilestonesToSimulation,
  buildDailyReport,
  closePosition,
  createInitialSimulation,
  estimatePositionPnl,
  loadConfig,
  loadReports,
  loadSimulation,
  milestoneSummary,
  normalizeMilestones,
  scannerRowsFromSignals,
  scannerRowsFromStocks,
  simFromEngine,
  tickSimulation,
} from "./lib/localSim";
import { BrokerLine, Panel } from "./components/ui";
import { CandleChart, EquityCurve } from "./components/charts";
import { ToastStack } from "./components/Toasts";
import { AnalyticsView } from "./views/AnalyticsView";
import { HistoryView } from "./views/HistoryView";
import { VerdictView } from "./views/VerdictView";

type Section = "trade" | "markets" | "risk" | "broker" | "lab" | "history" | "analytics" | "verdict";

const SECTION_TITLES: Record<Section, string> = {
  trade: "Trade Desk",
  markets: "Markets",
  risk: "Risk & Reports",
  broker: "Broker",
  lab: "Backtest Lab",
  history: "Trade History",
  analytics: "Analytics",
  verdict: "Verdict",
};

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("aindra-theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [sim, setSim] = useState<Simulation>(() => loadSimulation());
  const [reports, setReports] = useState<DailyReport[]>(() => loadReports());
  const [activeView, setActiveView] = useState<Section>("trade");
  const [verdict, setVerdict] = useState<VerdictPayload | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryPayload | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [tradeQuality, setTradeQuality] = useState<TradeQualityPayload | null>(null);
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [brokerError, setBrokerError] = useState("Checking");
  const [strategyPayload, setStrategyPayload] = useState<StrategyPayload | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [startNotice, setStartNotice] = useState("");
  const [requestToken, setRequestToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("request_token") ?? "";
  });
  const [brokerMessage, setBrokerMessage] = useState("");
  const [brokerBusy, setBrokerBusy] = useState(false);
  const [paperState, setPaperState] = useState<PaperEngineState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [candles, setCandles] = useState<CandlePayload | null>(null);
  const simRef = useRef(sim);
  const configRef = useRef(config);
  const seenTradeIdsRef = useRef<Set<string>>(new Set());
  const lastEngineStatusRef = useRef<string>("");
  const brokerOnline = Boolean(brokerStatus);

  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  function pushToast(toast: Omit<Toast, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 8000);
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function browserNotify(title: string, body: string) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      try {
        new Notification(title, { body });
      } catch {
        // notifications are best effort
      }
    }
  }

  async function refreshBrokerStatus() {
    try {
      const response = await fetch("/api/broker/status");
      if (!response.ok) {
        throw new Error("Broker API unavailable");
      }
      const payload = (await response.json()) as BrokerStatus;
      setBrokerStatus(payload);
      setBrokerError("");
    } catch {
      setBrokerStatus(null);
      setBrokerError("Offline");
    }
  }

  async function refreshServerIntelligence(active = true) {
    try {
      const [strategyResponse, riskResponse, backtestResponse] = await Promise.all([
        fetch(`/api/strategy/signals?${configQuery(config)}`),
        fetch(`/api/risk/state?${configQuery(config)}`),
        fetch("/api/backtest/latest"),
      ]);
      if (!active) {
        return;
      }
      if (strategyResponse.ok) {
        setStrategyPayload((await strategyResponse.json()) as StrategyPayload);
      }
      if (riskResponse.ok) {
        setRiskState((await riskResponse.json()) as RiskState);
      }
      if (backtestResponse.ok) {
        setBacktest((await backtestResponse.json()) as BacktestResult | null);
      }
    } catch {
      if (active) {
        setServerMessage("Server intelligence offline");
      }
    }
  }

  async function refreshTradeHistory(active = true) {
    try {
      const response = await fetch(`/api/trade-history?capital=${configRef.current.capital}&limit=50000`);
      if (!response.ok) {
        throw new Error("Trade history unavailable");
      }
      const payload = (await response.json()) as TradeHistoryPayload;
      if (active) {
        setTradeHistory(payload);
        setHistoryError("");
      }
    } catch {
      if (active) {
        setHistoryError("Trade history unavailable. Start the API server and refresh.");
      }
    }
  }

  async function refreshAnalytics(active = true) {
    try {
      const [performanceResponse, qualityResponse] = await Promise.all([
        fetch(`/api/analytics/performance?capital=${configRef.current.capital}&limit=50000`),
        fetch(`/api/analytics/trade-quality?capital=${configRef.current.capital}&limit=200`),
      ]);
      if (!performanceResponse.ok) {
        throw new Error("Analytics unavailable");
      }
      const payload = (await performanceResponse.json()) as AnalyticsPayload;
      const quality = qualityResponse.ok ? ((await qualityResponse.json()) as TradeQualityPayload) : null;
      if (active) {
        setAnalytics(payload);
        setTradeQuality(quality);
        setAnalyticsError("");
      }
    } catch {
      if (active) {
        setAnalyticsError("Analytics unavailable. Start the API server and let the strategy scanner collect signals.");
      }
    }
  }

  async function refreshVerdict(active = true) {
    try {
      const response = await fetch(`/api/verdict?capital=${configRef.current.capital}`);
      if (!response.ok) {
        throw new Error("Verdict unavailable");
      }
      const payload = (await response.json()) as VerdictPayload;
      if (active) {
        setVerdict(payload);
      }
    } catch {
      if (active) {
        setVerdict(null);
      }
    }
  }

  async function refreshPaperState(active = true) {
    try {
      const response = await fetch("/api/paper/state");
      if (!response.ok) {
        throw new Error("Paper engine unavailable");
      }
      const payload = (await response.json()) as PaperEngineState;
      if (active) {
        setPaperState(payload);
        if (payload.lastMessage) {
          setServerMessage(payload.lastMessage);
        }
      }
    } catch {
      if (active) {
        setPaperState(null);
      }
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aindra-theme", theme);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("request_token")) {
      return;
    }
    params.delete("request_token");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(sim));
  }, [sim]);

  useEffect(() => {
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
  }, [reports]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSim((current) => {
        if (brokerStatus) {
          return {
            ...current,
            ticks: current.ticks + 1,
          };
        }
        return tickSimulation(current, config);
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [brokerStatus, config]);

  useEffect(() => {
    let active = true;

    async function refreshIfActive() {
      if (active) {
        await refreshBrokerStatus();
      }
    }

    refreshIfActive();
    const timer = window.setInterval(refreshIfActive, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    refreshServerIntelligence(active);
    const timer = window.setInterval(() => refreshServerIntelligence(active), 12000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config]);

  useEffect(() => {
    let active = true;

    refreshTradeHistory(active);
    const timer = window.setInterval(() => refreshTradeHistory(active), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config.capital]);

  useEffect(() => {
    let active = true;

    refreshAnalytics(active);
    refreshVerdict(active);
    const timer = window.setInterval(() => {
      refreshAnalytics(active);
      refreshVerdict(active);
    }, 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config.capital]);

  // Poll the backend bot engine — it owns the paper runtime. The browser is
  // a viewer/controller; closing the tab no longer stops the bot.
  useEffect(() => {
    if (!brokerOnline) {
      return;
    }
    let active = true;
    refreshPaperState(active);
    const timer = window.setInterval(() => refreshPaperState(active), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerOnline]);

  useEffect(() => {
    if (!paperState) {
      return;
    }
    setSim((current) => simFromEngine(current, paperState, configRef.current));
  }, [paperState]);

  useEffect(() => {
    if (!brokerOnline || !strategyPayload?.signals.length) {
      return;
    }
    setSim((current) => ({
      ...current,
      stocks: applyBackendSignals(current.stocks, strategyPayload.signals),
    }));
  }, [brokerOnline, strategyPayload]);

  // Toasts + browser notifications for engine events.
  useEffect(() => {
    if (!paperState) {
      return;
    }
    const seen = seenTradeIdsRef.current;
    const isFirstLoad = seen.size === 0 && paperState.sessionTrades.length > 0;
    for (const trade of paperState.sessionTrades) {
      if (seen.has(trade.id)) {
        continue;
      }
      seen.add(trade.id);
      if (isFirstLoad) {
        continue; // do not replay history as toasts on page load
      }
      if (trade.status === "ENTRY") {
        pushToast({ tone: "info", title: `Entry: ${trade.symbol}`, body: `${trade.side} ${trade.qty} @ ${formatCurrency(trade.price, 2)}` });
        browserNotify("Aindra entry", `${trade.side} ${trade.symbol} x ${trade.qty}`);
      } else if (trade.status === "EXIT") {
        const tone = trade.pnl >= 0 ? "gain" : "loss";
        pushToast({ tone, title: `Exit: ${trade.symbol}`, body: `${trade.reason ?? "exit"} | net ${formatCurrency(trade.pnl, 2)}` });
        browserNotify("Aindra exit", `${trade.symbol} net ${formatCurrency(trade.pnl, 2)}`);
      }
    }
    const status = paperState.status;
    if (lastEngineStatusRef.current && lastEngineStatusRef.current !== status) {
      if (status === "target-hit") {
        pushToast({ tone: "gain", title: "Daily target hit", body: `Net ${formatCurrency(paperState.dayPnl, 2)}. Bot stopped.` });
      } else if (status === "loss-hit") {
        pushToast({ tone: "loss", title: "Daily loss limit", body: `Net ${formatCurrency(paperState.dayPnl, 2)}. Bot stopped.` });
      } else if (status === "closed") {
        pushToast({ tone: "info", title: "Day closed", body: `Net ${formatCurrency(paperState.dayPnl, 2)}.` });
      }
    }
    lastEngineStatusRef.current = status;
  }, [paperState]);

  // Candle chart data for the open position (or the agent's focus symbol).
  const chartSymbol = paperState?.positions[0]?.symbol ?? strategyPayload?.decision.symbol ?? strategyPayload?.signals[0]?.symbol ?? null;

  useEffect(() => {
    if (!brokerOnline || !chartSymbol) {
      setCandles(null);
      return;
    }
    let active = true;
    async function loadCandles() {
      try {
        const response = await fetch(`/api/market/candles?symbol=${encodeURIComponent(chartSymbol ?? "")}&interval=5minute&days=1`);
        if (!response.ok) {
          throw new Error("candles unavailable");
        }
        const payload = (await response.json()) as CandlePayload;
        if (active) {
          setCandles(payload);
        }
      } catch {
        if (active) {
          setCandles(null);
        }
      }
    }
    loadCandles();
    const timer = window.setInterval(loadCandles, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [brokerOnline, chartSymbol]);

  const targetAmount = (config.capital * config.targetPct) / 100;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const unrealizedPnl = useMemo(
    () => sim.positions.reduce((total, position) => total + estimatePositionPnl(position, sim.stocks, config), 0),
    [config, sim.positions, sim.stocks]
  );
  const dayPnl = paperState?.dayPnl ?? sim.realizedPnl + unrealizedPnl;
  const currentMilestones = useMemo(
    () => normalizeMilestones(sim.milestones, config.capital),
    [config.capital, sim.milestones]
  );
  const gaveBackFromPeak = Math.max(0, currentMilestones.peakPnl - dayPnl);
  const rankedStocks = useMemo(() => [...sim.stocks].sort((a, b) => b.score - a.score), [sim.stocks]);
  const scannerRows = useMemo(() => {
    if (strategyPayload?.signals.length) {
      return scannerRowsFromSignals(strategyPayload.signals);
    }
    return scannerRowsFromStocks(rankedStocks);
  }, [rankedStocks, strategyPayload]);
  const scannerSource = strategyPayload?.source ?? scannerRows[0]?.source ?? "local-sim";
  const eligibleStocks = useMemo(
    () =>
      rankedStocks.filter(
        (item) =>
          item.price <= config.capital * 0.98 &&
          item.score >= config.minScore &&
          Math.abs(item.momentum) >= config.minMomentumPct &&
          item.spreadBps <= config.maxSpreadBps
      ),
    [config, rankedStocks]
  );
  const topSignal = eligibleStocks[0] ?? rankedStocks[0];
  const progress = clamp((dayPnl / targetAmount) * 100, -100, 100);
  const riskProgress = clamp((Math.abs(Math.min(dayPnl, 0)) / lossAmount) * 100, 0, 100);
  const sessionLocked = sim.status === "target-hit" || sim.status === "loss-hit" || sim.status === "closed";
  const effectiveTradesTaken = Math.max(sim.tradesTaken, riskState?.tradesTaken ?? 0);
  const entryLimitReached = effectiveTradesTaken >= config.maxTrades;
  const botCanArm = riskState ? riskState.botArmAllowed : true;
  const latestReport = reports[0];
  const closedReports = reports.filter((report) => report.status !== "idle" && report.status !== "running");
  const profitableReports = closedReports.filter((report) => report.netPnl > 0);
  const reportWinRate = closedReports.length ? Math.round((profitableReports.length / closedReports.length) * 100) : 0;
  const canUseKiteAuth = Boolean(brokerStatus?.apiConfigured) && !brokerBusy;
  const canConnectKite = canUseKiteAuth && Boolean(requestToken.trim());
  const backendTopSignal = strategyPayload?.signals[0];
  const backendEligible = strategyPayload?.signals.filter((signal) => signal.eligible).length ?? 0;
  const displayedSignalSymbol = strategyPayload?.decision.symbol ?? topSignal?.symbol ?? "-";
  const displayedSignalScore = backendTopSignal?.score ?? topSignal?.score ?? 0;
  const displayedMomentum = backendTopSignal?.momentumPct ?? topSignal?.momentum ?? 0;
  const displayedRelativeStrength = backendTopSignal?.relativeStrengthPct ?? 0;
  const displayedMarketRegime = strategyPayload?.marketRegime?.label ?? backendTopSignal?.marketRegime?.label ?? "unknown";
  const displayedVix = strategyPayload?.marketRegime?.vix;
  const displayedBreadth = strategyPayload?.marketRegime?.breadth ?? "-";
  const displayedNetRewardRisk = backendTopSignal?.netRewardRisk ?? 0;
  const displayedStrategy = strategyPayload?.decision.strategy ?? backendTopSignal?.strategy ?? config.strategyMode;
  const displayedSide = strategyPayload?.decision.side ?? backendTopSignal?.side ?? (displayedMomentum < 0 ? "SELL" : "BUY");
  const displayedDirection = displayedSide === "SELL" ? "Short" : "Long";
  const displayedAgent = entryLimitReached ? "LOCKED" : (strategyPayload?.decision.action ?? "WAIT");
  const strategyBrainMessage = entryLimitReached
    ? `Daily max trades reached (${effectiveTradesTaken}/${config.maxTrades}). New long or short entries are blocked today.`
    : (strategyPayload?.decision.reason ?? serverMessage);
  const rateLimitDelayed = Object.values(brokerStatus?.rateLimits ?? {}).reduce((total, item) => total + item.delayed, 0);
  const paperEngineLabel = brokerStatus
    ? brokerStatus.dataSource === "kite-ws"
      ? "Kite Stream"
      : brokerStatus.dataSource === "kite-rest"
        ? "Kite Paper"
        : "Server Paper"
    : "Local Sim";
  const marketStatusLabel = riskState?.marketOpen
    ? riskState.freshEntriesAllowed
      ? "Market Open"
      : "Open - Entries Blocked"
    : riskState?.sessionPhase === "preopen"
      ? "Pre-open"
      : riskState?.botArmAllowed
        ? "Arm Ready"
        : "Market Closed";
  const nextOpenLabel = formatNextOpen(riskState?.nextOpenAt);
  const marketBannerText = riskState?.marketOpen
    ? riskState.freshEntriesAllowed
      ? "Market is open. Bot can take fresh paper entries when strategy gates pass."
      : riskState.botArmAllowed
        ? "Bot can be armed now and will wait until fresh entries are allowed."
        : "Market is open, but fresh entries are blocked by the session guard."
    : riskState?.botArmAllowed
      ? `Bot can be armed now and will wait for market open.${nextOpenLabel ? ` Next open: ${nextOpenLabel}.` : ""}`
      : `Market is closed${riskState?.sessionReason ? `: ${riskState.sessionReason}` : ""}.${nextOpenLabel ? ` Next open: ${nextOpenLabel}.` : ""}`;
  const engineHealthy = paperState?.heartbeat.healthy ?? false;

  useEffect(() => {
    if (!sessionLocked) {
      return;
    }
    const reportSim = applyMilestonesToSimulation(sim, config, [dayPnl]);
    const report = buildDailyReport(reportSim, config, dayPnl);
    setReports((current) => {
      const existing = current.find((item) => item.id === report.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(report)) {
        return current;
      }
      return [report, ...current.filter((item) => item.id !== report.id)].slice(0, 40);
    });
  }, [config, dayPnl, sessionLocked, sim]);

  function updateConfig<Key extends keyof Config>(key: Key, value: Config[Key]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function startBot() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (!brokerStatus) {
      setStartNotice("API server is offline. Start the backend before starting the bot.");
      setServerMessage("API server must be online before starting the bot.");
      return;
    }
    if (!brokerStatus.apiConfigured) {
      setStartNotice("Kite API key and secret are required before starting.");
      setBrokerMessage("Add Kite API key and secret before starting the bot.");
      setServerMessage("Kite API key and secret are required before starting.");
      return;
    }
    if (brokerStatus.tokenState !== "ready") {
      setStartNotice("Connect Zerodha first. The bot will not start without today's Kite token.");
      setBrokerMessage("Connect Zerodha first, then start the bot.");
      setServerMessage("Zerodha is not connected. Complete daily login before starting.");
      return;
    }
    setStartNotice("");
    try {
      const response = await fetch("/api/paper/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to start the bot");
      }
      setServerMessage("Bot started on the server. It keeps running even if you close this tab.");
      await refreshPaperState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start the bot";
      setStartNotice(message);
      setServerMessage(message);
    }
  }

  async function pauseBot() {
    if (brokerStatus) {
      try {
        const response = await fetch("/api/paper/pause", { method: "POST" });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to pause/resume the bot");
        }
        await refreshPaperState();
      } catch (error) {
        setServerMessage(error instanceof Error ? error.message : "Unable to pause/resume the bot");
      }
      return;
    }
    setSim((current) => ({
      ...current,
      status: current.status === "running" ? "paused" : current.status === "paused" ? "running" : current.status,
    }));
  }

  async function closeDay() {
    if (brokerStatus) {
      try {
        const response = await fetch("/api/paper/close-day", { method: "POST" });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to close the day");
        }
        await refreshPaperState();
        await refreshTradeHistory();
        await refreshServerIntelligence();
      } catch (error) {
        setServerMessage(error instanceof Error ? error.message : "Unable to close the day");
      }
      return;
    }
    // Offline demo mode: close the local simulation only. Nothing is written
    // to the backend ledger because nothing real happened.
    const current = simRef.current;
    const exits = current.positions.map((position) => closePosition(position, current.stocks, config));
    const preClosePnl =
      current.realizedPnl +
      current.positions.reduce((total, position) => total + estimatePositionPnl(position, current.stocks, config), 0);
    const next = applyMilestonesToSimulation(
      {
        ...current,
        positions: [],
        trades: [...exits.map((exit) => exit.trade), ...current.trades],
        realizedPnl: current.realizedPnl + exits.reduce((total, exit) => total + exit.pnl, 0),
        status: "closed",
        closedAt: nowLabel(),
        stats: {
          ...current.stats,
          orders: current.stats.orders + exits.length,
          fills: current.stats.fills + exits.length,
        },
      },
      config,
      [preClosePnl]
    );
    simRef.current = next;
    setSim(next);
  }

  function resetDay() {
    setSim(createInitialSimulation());
    if (brokerOnline) {
      void refreshPaperState();
    }
  }

  function exportJournal() {
    const rows = [...sim.trades].reverse().map((trade) => ({
      time: trade.time,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.qty,
      price: trade.price.toFixed(2),
      charges: trade.charges.toFixed(2),
      netPnl: trade.pnl.toFixed(2),
      status: trade.status,
    }));
    downloadCsv(`aindra-journal-${sim.tradeDate}.csv`, toCsv(rows));
  }

  function exportTradeHistory() {
    if (!tradeHistory?.trades.length) {
      return;
    }
    const rows = tradeHistory.trades.map((trade) => ({
      date: trade.date,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      entryAt: trade.entryAt,
      exitAt: trade.exitAt ?? "",
      entryPrice: trade.entryPrice.toFixed(2),
      exitPrice: trade.exitPrice?.toFixed(2) ?? "",
      charges: trade.charges.toFixed(2),
      netPnl: trade.netPnl.toFixed(2),
      tradeReturnPct: trade.netPct.toFixed(2),
      capitalReturnPct: trade.capitalPct.toFixed(2),
      status: trade.status,
      mode: trade.mode,
    }));
    downloadCsv(`aindra-trade-history-${todayKey()}.csv`, toCsv(rows));
  }

  function exportAnalytics() {
    if (!analytics) {
      return;
    }
    const rows = [
      ...analytics.tradePerformance.byStrategy.map((row) => ({
        section: "trade-by-strategy",
        key: row.key,
        samples: row.trades,
        eligible: "",
        tradeDecisions: "",
        winRate: row.winRate.toFixed(2),
        netPnl: row.netPnl.toFixed(2),
        avgScore: "",
        avgRelativeStrength: "",
        avgNetRewardRisk: "",
      })),
      ...analytics.signalQuality.byStrategy.map((row) => ({
        section: "signal-by-strategy",
        key: row.key,
        samples: row.samples,
        eligible: row.eligible,
        tradeDecisions: row.tradeDecisions,
        winRate: "",
        netPnl: "",
        avgScore: row.avgScore.toFixed(2),
        avgRelativeStrength: row.avgRelativeStrength.toFixed(2),
        avgNetRewardRisk: row.avgNetRewardRisk.toFixed(2),
      })),
      ...analytics.signalQuality.byRegime.map((row) => ({
        section: "signal-by-regime",
        key: row.key,
        samples: row.snapshots,
        eligible: row.eligibleSignals,
        tradeDecisions: row.tradeDecisions,
        winRate: "",
        netPnl: "",
        avgScore: "",
        avgRelativeStrength: "",
        avgNetRewardRisk: "",
      })),
    ];
    downloadCsv(`aindra-analytics-${todayKey()}.csv`, toCsv(rows));
  }

  function exportReports() {
    const rows = reports.map((report) => ({
      date: report.date,
      status: statusLabel(report.status),
      startedAt: report.startedAt,
      closedAt: report.closedAt,
      capital: report.capital,
      targetAmount: report.targetAmount.toFixed(2),
      lossAmount: report.lossAmount.toFixed(2),
      netPnl: report.netPnl.toFixed(2),
      tradesTaken: report.tradesTaken,
      fills: report.fills,
      rejections: report.rejections,
      charges: report.charges.toFixed(2),
      slippageCost: report.slippageCost.toFixed(2),
      peakPnl: (report.peakPnl ?? 0).toFixed(2),
      peakPct: (report.peakPct ?? 0).toFixed(2),
      maxDrawdownPnl: (report.maxDrawdownPnl ?? 0).toFixed(2),
      maxDrawdownPct: (report.maxDrawdownPct ?? 0).toFixed(2),
      milestonesHit: report.milestonesHit ?? "-",
      gaveBackFromPeak: (report.gaveBackFromPeak ?? 0).toFixed(2),
    }));
    downloadCsv(`aindra-reports-${todayKey()}.csv`, toCsv(rows));
  }

  async function openZerodhaLogin() {
    setBrokerBusy(true);
    setStartNotice("");
    setBrokerMessage("");
    try {
      const response = await fetch("/api/broker/zerodha/login-url");
      const payload = (await response.json()) as { loginUrl?: string; error?: string };
      if (!response.ok || !payload.loginUrl) {
        throw new Error(payload.error ?? "Unable to create Zerodha login URL");
      }
      window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
      setBrokerMessage("Zerodha login opened. Paste the request token here after redirect.");
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Unable to open Zerodha login");
    } finally {
      setBrokerBusy(false);
    }
  }

  async function connectZerodhaSession() {
    const token = requestToken.trim();
    if (!token) {
      setBrokerMessage("Paste the Zerodha request token first.");
      return;
    }

    setBrokerBusy(true);
    setBrokerMessage("");
    try {
      const response = await fetch("/api/broker/zerodha/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestToken: token }),
      });
      const payload = (await response.json()) as BrokerStatus | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to connect Zerodha session");
      }
      setBrokerStatus(payload as BrokerStatus);
      setBrokerMessage("Zerodha token connected and saved for today. Live orders are still locked.");
      setStartNotice("");
      setRequestToken("");
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Unable to connect Zerodha session");
    } finally {
      setBrokerBusy(false);
      refreshBrokerStatus();
    }
  }

  async function runBacktestNow() {
    setBacktestBusy(true);
    setServerMessage("");
    try {
      const response = await fetch("/api/backtest/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config, days: 10 }),
      });
      const payload = (await response.json()) as BacktestResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Backtest failed");
      }
      setBacktest(payload as BacktestResult);
      setServerMessage("Backtest completed with current strategy gates.");
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : "Backtest failed");
    } finally {
      setBacktestBusy(false);
      refreshServerIntelligence();
    }
  }

  async function toggleKillSwitch() {
    const active = !riskState?.killSwitchActive;
    try {
      const response = await fetch("/api/risk/kill-switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active, reason: "dashboard" }),
      });
      if (!response.ok) {
        throw new Error("Risk server unavailable");
      }
      const payload = (await response.json()) as RiskState;
      setRiskState((current) => ({ ...(current ?? payload), ...payload }));
      setServerMessage(active ? "Kill switch activated." : "Kill switch released.");
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : "Unable to update kill switch");
    }
  }

  const navItems: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
    { id: "trade", label: "Trade Desk", icon: <Gauge size={17} /> },
    { id: "markets", label: "Markets", icon: <Radar size={17} /> },
    { id: "risk", label: "Risk & Reports", icon: <ShieldCheck size={17} /> },
    { id: "broker", label: "Broker", icon: <PlugZap size={17} /> },
    { id: "lab", label: "Backtest Lab", icon: <FlaskConical size={17} /> },
    { id: "history", label: "History", icon: <Database size={17} /> },
    { id: "analytics", label: "Analytics", icon: <BarChart3 size={17} /> },
    { id: "verdict", label: "Verdict", icon: <Scale size={17} /> },
  ];

  const journalPanel = (
    <Panel title="Trade Journal" icon={<Activity size={18} />}>
      <div className="journal-toolbar">
        <div className="panel-meta">
          <span>Today's session</span>
        </div>
        <div className="journal-actions">
          <button className="mini-action" type="button" onClick={exportJournal} disabled={!sim.trades.length}>
            <Download size={16} aria-hidden="true" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      <div className="journal-table">
        <div className="journal-head">
          <span>Time</span>
          <span>Symbol</span>
          <span>Side</span>
          <span>Qty</span>
          <span>Price</span>
          <span>Charges</span>
          <span>Net P&L</span>
          <span>Status</span>
        </div>
        {sim.trades.length ? (
          sim.trades.slice(0, 8).map((trade) => (
            <div className="journal-row" key={trade.id}>
              <span>{trade.time}</span>
              <strong>{trade.symbol}</strong>
              <span className={trade.side === "BUY" ? "gain" : "loss"}>{trade.side}</span>
              <span>{trade.qty}</span>
              <span>{formatCurrency(trade.price, 2)}</span>
              <span>{formatCurrency(trade.charges, 2)}</span>
              <span className={trade.pnl >= 0 ? "gain" : "loss"}>{formatCurrency(trade.pnl, 2)}</span>
              <span>{trade.status}</span>
            </div>
          ))
        ) : (
          <div className="journal-empty">Waiting for first signal</div>
        )}
      </div>
    </Panel>
  );

  const tradeView = (
    <>
      <section className="hud-strip" aria-label="Daily metrics">
        <div className="hud-chip primary">
          <span>Net P&L</span>
          <strong className={dayPnl >= 0 ? "gain" : "loss"}>{formatCurrency(dayPnl, 2)}</strong>
          <small>
            target {formatCurrency(targetAmount)} | stop -{formatCurrency(lossAmount)}
          </small>
          <div className="progress-stack">
            <div className="target-track">
              <span style={{ width: `${Math.max(0, progress)}%` }} />
            </div>
            <div className="risk-track">
              <span style={{ width: `${riskProgress}%` }} />
            </div>
          </div>
        </div>
        <div className="hud-chip">
          <span>Trades</span>
          <strong>
            {effectiveTradesTaken}/{config.maxTrades}
          </strong>
          <small>{sim.stats.fills} fills | {sim.stats.rejections} rejected</small>
        </div>
        <div className="hud-chip">
          <span>Agent</span>
          <strong className={displayedAgent === "TRADE" ? "gain" : displayedAgent === "LOCKED" ? "loss" : undefined}>
            {displayedAgent}
          </strong>
          <small>
            {displayedSignalSymbol} | {displayedDirection} | {strategyLabel(displayedStrategy)}
          </small>
        </div>
        <div className="hud-chip">
          <span>Regime</span>
          <strong>{displayedMarketRegime}</strong>
          <small>VIX {displayedVix ? displayedVix.toFixed(1) : "-"} | breadth {displayedBreadth}</small>
        </div>
        <div className="hud-chip">
          <span>Engine</span>
          <strong className={engineHealthy ? "gain" : undefined}>{paperEngineLabel}</strong>
          <small>{sourceLabel(scannerSource)} | {marketStatusLabel}</small>
        </div>
      </section>

      <section className="cockpit-grid">
        <div className="stack">
          <Panel title="Today's P&L Curve" icon={<LineChart size={18} />}>
            <EquityCurve series={paperState?.pnlSeries ?? []} targetAmount={targetAmount} lossAmount={lossAmount} />
          </Panel>
          <Panel title="Price Action" icon={<TrendingUp size={18} />}>
            {candles ? (
              <CandleChart payload={candles} position={paperState?.positions[0] ?? null} />
            ) : (
              <div className="journal-empty">
                {brokerOnline ? "Loading candles" : "Connect the API server for live candles"}
              </div>
            )}
          </Panel>
          {journalPanel}
        </div>

        <div className="stack">
          <Panel title="Bot Control" icon={<Bot size={18} />}>
            <div className={`market-banner ${riskState?.marketOpen ? "open" : "closed"}`}>
              <strong>{marketStatusLabel}</strong>
              <span>{marketBannerText}</span>
            </div>
            <div className="command-row">
              <button
                className="primary-action"
                type="button"
                onClick={startBot}
                disabled={sim.status !== "idle" || sessionLocked || riskState?.killSwitchActive}
                title={
                  brokerStatus?.tokenState !== "ready"
                    ? "Connect Zerodha before starting"
                    : botCanArm && !riskState?.freshEntriesAllowed
                      ? "Arm bot and wait for entry window"
                      : "Start bot"
                }
              >
                <Play size={18} aria-hidden="true" />
                <span>{botCanArm && !riskState?.freshEntriesAllowed ? "Arm Bot" : "Start Bot"}</span>
              </button>
              <button
                className="ghost-action"
                type="button"
                onClick={pauseBot}
                disabled={sim.status !== "running" && sim.status !== "paused"}
              >
                {sim.status === "paused" ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
                <span>{sim.status === "paused" ? "Resume" : "Pause"}</span>
              </button>
              <button
                className="ghost-action danger"
                type="button"
                onClick={closeDay}
                disabled={sim.status === "idle" || sessionLocked}
              >
                <Square size={17} aria-hidden="true" />
                <span>Close Day</span>
              </button>
            </div>
            <div className="report-actions">
              <button className="mini-action" type="button" onClick={resetDay}>
                <RefreshCw size={15} aria-hidden="true" />
                <span>Reset View</span>
              </button>
              <button
                className={`mini-action ${riskState?.killSwitchActive ? "" : "danger"}`}
                type="button"
                onClick={toggleKillSwitch}
              >
                <ShieldCheck size={15} aria-hidden="true" />
                <span>{riskState?.killSwitchActive ? "Release Kill Switch" : "Kill Switch"}</span>
              </button>
            </div>
            {startNotice ? (
              <div className="command-alert" role="alert" style={{ marginTop: 10 }}>
                {startNotice}
              </div>
            ) : null}
            <p className="broker-note">{strategyBrainMessage}</p>
          </Panel>

          <Panel title="Open Position" icon={<CircleDollarSign size={18} />}>
            {sim.positions.length ? (
              <div className="position-table">
                {sim.positions.map((position) => {
                  const pnl = estimatePositionPnl(position, sim.stocks, config);
                  return (
                    <div className="position-row" key={position.id}>
                      <div>
                        <span>{position.side === "SHORT" ? "Short" : "Long"}</span>
                        <strong>
                          {position.symbol} x {position.qty}
                        </strong>
                      </div>
                      <div>
                        <span>Entry</span>
                        <strong>{formatCurrency(position.entryPrice, 2)}</strong>
                      </div>
                      <div>
                        <span>LTP</span>
                        <strong>{formatCurrency(position.lastPrice, 2)}</strong>
                      </div>
                      <div>
                        <span>Net</span>
                        <strong className={pnl >= 0 ? "gain" : "loss"}>{formatCurrency(pnl, 2)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <Activity size={22} aria-hidden="true" />
                <span>No open exposure</span>
              </div>
            )}
          </Panel>

          <Panel title="Signal Snapshot" icon={<Cpu size={18} />}>
            <div className="strategy-grid">
              <div>
                <span>Top Signal</span>
                <strong>{displayedSignalSymbol}</strong>
              </div>
              <div>
                <span>Score</span>
                <strong>{displayedSignalScore}</strong>
              </div>
              <div>
                <span>Qualified</span>
                <strong>{backendEligible || eligibleStocks.length}</strong>
              </div>
              <div>
                <span>Momentum</span>
                <strong className={displayedMomentum >= 0 ? "gain" : "loss"}>{`${displayedMomentum.toFixed(2)}%`}</strong>
              </div>
              <div>
                <span>Rel Strength</span>
                <strong className={displayedRelativeStrength >= 0 ? "gain" : "loss"}>
                  {`${displayedRelativeStrength.toFixed(2)}%`}
                </strong>
              </div>
              <div>
                <span>Net R:R</span>
                <strong>{displayedNetRewardRisk.toFixed(2)}</strong>
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </>
  );

  const marketsView = (
    <section className="cockpit-grid">
      <div className="stack">
        <Panel title="Strategy Scanner" icon={<Radar size={18} />}>
          <div className="panel-meta">
            <span>{sourceLabel(scannerSource)}</span>
            <span>{strategyPayload ? new Date(strategyPayload.generatedAt).toLocaleTimeString("en-IN") : "waiting"}</span>
          </div>
          <div className="scanner-list">
            {scannerRows.slice(0, 14).map((item) => {
              return (
                <div className="scanner-row" key={item.symbol}>
                  <div className="symbol-block">
                    <strong>{item.symbol}</strong>
                    <span>{item.sector}</span>
                  </div>
                  <div className="price-block">
                    <strong>{formatCurrency(item.price, 2)}</strong>
                    <span className={item.changePct >= 0 ? "gain" : "loss"}>
                      {item.changePct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                      {item.changePct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="score-meter" aria-label={`${item.symbol} score ${item.score}`}>
                    <span style={{ width: `${item.score}%` }} />
                  </div>
                  <div className="compact-data">
                    <span className={item.side === "SELL" ? "loss" : "gain"}>{item.side === "SELL" ? "Short" : "Long"}</span>
                    <span>{formatNumber(item.volume)}</span>
                    <span>{item.spreadBps.toFixed(1)} bps</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Market Context" icon={<TrendingUp size={18} />}>
          <div className="strategy-grid">
            <div>
              <span>Regime</span>
              <strong>{displayedMarketRegime}</strong>
            </div>
            <div>
              <span>India VIX</span>
              <strong>{displayedVix ? displayedVix.toFixed(1) : "-"}</strong>
            </div>
            <div>
              <span>Breadth</span>
              <strong>{displayedBreadth}</strong>
            </div>
            <div>
              <span>Trend</span>
              <strong>{(strategyPayload?.marketRegime?.trendPct ?? 0).toFixed(2)}%</strong>
            </div>
            <div>
              <span>Volatility</span>
              <strong>{strategyPayload?.marketRegime?.volatility ?? "-"}</strong>
            </div>
            <div>
              <span>Data Source</span>
              <strong>{sourceLabel(strategyPayload?.source ?? brokerStatus?.dataSource ?? "simulator")}</strong>
            </div>
          </div>
          {strategyPayload?.dataQuality?.missingQuotes.length ? (
            <p className="broker-note warning">
              Missing real quotes: {strategyPayload.dataQuality.missingQuotes.join(", ")}
            </p>
          ) : null}
        </Panel>

        <Panel title="Agent Decision" icon={<Cpu size={18} />}>
          <div className="strategy-grid">
            <div>
              <span>Action</span>
              <strong className={displayedAgent === "TRADE" ? "gain" : displayedAgent === "LOCKED" ? "loss" : undefined}>
                {displayedAgent}
              </strong>
            </div>
            <div>
              <span>Symbol</span>
              <strong>{displayedSignalSymbol}</strong>
            </div>
            <div>
              <span>Direction</span>
              <strong className={displayedSide === "SELL" ? "loss" : "gain"}>{displayedDirection}</strong>
            </div>
            <div>
              <span>Strategy</span>
              <strong>{strategyLabel(displayedStrategy)}</strong>
            </div>
            <div>
              <span>Risk / Trade</span>
              <strong>{formatCurrency(strategyPayload?.decision.riskAmount ?? backendTopSignal?.positionRisk ?? 0, 2)}</strong>
            </div>
            <div>
              <span>Net R:R</span>
              <strong>{displayedNetRewardRisk.toFixed(2)}</strong>
            </div>
          </div>
          <p className="broker-note">{strategyBrainMessage}</p>
        </Panel>

        <Panel title="Price Action" icon={<TrendingUp size={18} />}>
          {candles ? (
            <CandleChart payload={candles} position={paperState?.positions[0] ?? null} />
          ) : (
            <div className="journal-empty">
              {brokerOnline ? "Loading candles" : "Connect the API server for live candles"}
            </div>
          )}
        </Panel>
      </div>
    </section>
  );

  const riskView = (
    <section className="cockpit-grid">
      <div className="stack">
        <Panel title="Risk Engine" icon={<ShieldCheck size={18} />}>
          <div className="control-grid">
            <label>
              <span>Capital</span>
              <input
                type="number"
                min={1000}
                step={500}
                value={config.capital}
                onChange={(event) => updateConfig("capital", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Strategy</span>
              <select
                value={config.strategyMode}
                onChange={(event) => updateConfig("strategyMode", event.target.value as Config["strategyMode"])}
              >
                <option value="hybrid">Hybrid</option>
                <option value="momentum">Momentum</option>
                <option value="mean-reversion">Mean Reversion</option>
                <option value="vwap-pullback">VWAP Pullback</option>
                <option value="opening-range">Opening Range</option>
              </select>
            </label>
            <label>
              <span>Profit Target</span>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.25}
                value={config.targetPct}
                onChange={(event) => updateConfig("targetPct", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Max Loss</span>
              <input
                type="number"
                min={0.25}
                max={3}
                step={0.25}
                value={config.maxLossPct}
                onChange={(event) => updateConfig("maxLossPct", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Risk / Trade</span>
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                value={config.riskPerTradePct}
                onChange={(event) => updateConfig("riskPerTradePct", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Max Trades</span>
              <input
                type="number"
                min={1}
                max={6}
                step={1}
                value={config.maxTrades}
                onChange={(event) => updateConfig("maxTrades", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Min Score</span>
              <input
                type="number"
                min={40}
                max={95}
                step={1}
                value={config.minScore}
                onChange={(event) => updateConfig("minScore", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Max Spread</span>
              <input
                type="number"
                min={3}
                max={30}
                step={1}
                value={config.maxSpreadBps}
                onChange={(event) => updateConfig("maxSpreadBps", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Stop Loss</span>
              <input
                type="number"
                min={0.3}
                max={2}
                step={0.1}
                value={config.stopLossPct}
                onChange={(event) => updateConfig("stopLossPct", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Trade Target</span>
              <input
                type="number"
                min={0.5}
                max={3}
                step={0.1}
                value={config.takeProfitPct}
                onChange={(event) => updateConfig("takeProfitPct", Number(event.target.value))}
              />
            </label>
            <label>
              <span>ATR Stop x</span>
              <input
                type="number"
                min={0.7}
                max={3}
                step={0.1}
                value={config.atrStopMultiplier}
                onChange={(event) => updateConfig("atrStopMultiplier", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Min Net R:R</span>
              <input
                type="number"
                min={0.8}
                max={3}
                step={0.1}
                value={config.minNetRewardRisk}
                onChange={(event) => updateConfig("minNetRewardRisk", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Max VIX</span>
              <input
                type="number"
                min={15}
                max={40}
                step={1}
                value={config.maxVix}
                onChange={(event) => updateConfig("maxVix", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Max Gap %</span>
              <input
                type="number"
                min={1}
                max={6}
                step={0.5}
                value={config.maxGapPct}
                onChange={(event) => updateConfig("maxGapPct", Number(event.target.value))}
              />
            </label>
          </div>
          <label className="slider-row">
            <span>Slippage</span>
            <input
              type="range"
              min={2}
              max={30}
              value={config.slippageBps}
              onChange={(event) => updateConfig("slippageBps", Number(event.target.value))}
            />
            <strong>{config.slippageBps} bps</strong>
          </label>
          <label className="slider-row">
            <span>Momentum</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={config.minMomentumPct}
              onChange={(event) => updateConfig("minMomentumPct", Number(event.target.value))}
            />
            <strong>{config.minMomentumPct.toFixed(1)}%</strong>
          </label>
          <label className="slider-row">
            <span>Rel Strength</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.minRelativeStrengthPct}
              onChange={(event) => updateConfig("minRelativeStrengthPct", Number(event.target.value))}
            />
            <strong>{config.minRelativeStrengthPct.toFixed(2)}%</strong>
          </label>
          <p className="broker-note">Config is sent to the server bot when you press Start.</p>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Live Risk Guard" icon={<ShieldCheck size={18} />}>
          <div className="strategy-grid">
            <div>
              <span>Market</span>
              <strong className={riskState?.marketOpen ? "gain" : "loss"}>{riskState?.sessionPhase ?? "closed"}</strong>
            </div>
            <div>
              <span>Fresh Entries</span>
              <strong className={riskState?.freshEntriesAllowed ? "gain" : "loss"}>
                {riskState?.freshEntriesAllowed ? "Allowed" : "Blocked"}
              </strong>
            </div>
            <div>
              <span>Kill Switch</span>
              <strong className={riskState?.killSwitchActive ? "loss" : "gain"}>
                {riskState?.killSwitchActive ? "Active" : "Clear"}
              </strong>
            </div>
            <div>
              <span>Server P&L</span>
              <strong className={(riskState?.dayPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {formatCurrency(riskState?.dayPnl ?? 0, 2)}
              </strong>
            </div>
            <div>
              <span>Trades</span>
              <strong>
                {riskState?.tradesTaken ?? 0}/{config.maxTrades}
              </strong>
            </div>
          </div>
          <div className="report-actions">
            <button className={`mini-action ${riskState?.killSwitchActive ? "" : "danger"}`} type="button" onClick={toggleKillSwitch}>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{riskState?.killSwitchActive ? "Release" : "Kill Switch"}</span>
            </button>
            <button className="mini-action" type="button" onClick={() => refreshServerIntelligence()}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </Panel>

        <Panel title="Target Tracker" icon={<TrendingUp size={18} />}>
          <div className="milestone-grid">
            {currentMilestones.levels.map((milestone) => (
              <div className={milestone.hit ? "milestone hit" : "milestone"} key={milestone.pct}>
                <span>{milestone.pct}%</span>
                <strong>{milestone.hit ? "Hit" : "Waiting"}</strong>
                <small>{formatCurrency(milestone.amount, 2)}</small>
              </div>
            ))}
          </div>
          <div className="strategy-grid compact">
            <div>
              <span>Peak</span>
              <strong className={currentMilestones.peakPnl >= 0 ? "gain" : "loss"}>
                {formatCurrency(currentMilestones.peakPnl, 2)}
              </strong>
            </div>
            <div>
              <span>Give-back</span>
              <strong className={gaveBackFromPeak > 0 ? "loss" : "gain"}>{formatCurrency(gaveBackFromPeak, 2)}</strong>
            </div>
            <div>
              <span>Lowest</span>
              <strong className={currentMilestones.maxDrawdownPnl < 0 ? "loss" : "gain"}>
                {formatCurrency(currentMilestones.maxDrawdownPnl, 2)}
              </strong>
            </div>
            <div>
              <span>Hit List</span>
              <strong>{milestoneSummary(currentMilestones)}</strong>
            </div>
          </div>
        </Panel>

        <Panel title="Execution Quality" icon={<AlertTriangle size={18} />}>
          <div className="quality-grid">
            <div>
              <span>Orders</span>
              <strong>{sim.stats.orders}</strong>
            </div>
            <div>
              <span>Fills</span>
              <strong>{sim.stats.fills}</strong>
            </div>
            <div>
              <span>Rejected</span>
              <strong>{sim.stats.rejections}</strong>
            </div>
            <div>
              <span>Slippage</span>
              <strong>{formatCurrency(sim.stats.slippageCost, 2)}</strong>
            </div>
          </div>
        </Panel>

        <Panel title="Daily Reports" icon={<FileClock size={18} />}>
          <div className="report-grid">
            <div>
              <span>Saved Days</span>
              <strong>{reports.length}</strong>
            </div>
            <div>
              <span>Win Rate</span>
              <strong>{reportWinRate}%</strong>
            </div>
            <div>
              <span>Last Net</span>
              <strong className={(latestReport?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {latestReport ? formatCurrency(latestReport.netPnl, 2) : formatCurrency(0, 2)}
              </strong>
            </div>
            <div>
              <span>Last Status</span>
              <strong>{latestReport ? statusLabel(latestReport.status) : "No Report"}</strong>
            </div>
          </div>
          <div className="report-actions">
            <button className="mini-action" type="button" onClick={exportJournal} disabled={!sim.trades.length}>
              <Download size={16} aria-hidden="true" />
              <span>Journal CSV</span>
            </button>
            <button className="mini-action" type="button" onClick={exportReports} disabled={!reports.length}>
              <Database size={16} aria-hidden="true" />
              <span>Reports CSV</span>
            </button>
          </div>
        </Panel>
      </div>
    </section>
  );

  const brokerView = (
    <section className="cockpit-grid">
      <div className="stack">
        <Panel title="Broker Boundary" icon={<PlugZap size={18} />}>
          <div className="broker-grid">
            <BrokerLine label="API Server" value={brokerStatus ? "Online" : brokerError} state={brokerStatus ? "active" : "warning"} />
            <BrokerLine label="Mode" value={brokerStatus?.mode === "live" ? "Live" : "Paper"} state="active" />
            <BrokerLine label="Paper Engine" value={paperEngineLabel} state="active" />
            <BrokerLine label="Bot Heartbeat" value={engineHealthy ? "Healthy" : "Idle"} state={engineHealthy ? "active" : "neutral"} />
            <BrokerLine
              label="API Key"
              value={brokerStatus?.apiConfigured ? "Configured" : "Missing"}
              state={brokerStatus?.apiConfigured ? "active" : "warning"}
            />
            <BrokerLine
              label="Login Token"
              value={brokerStatus?.tokenState === "ready" ? "Ready" : "Not connected"}
              state={brokerStatus?.tokenState === "ready" ? "active" : "warning"}
            />
            <BrokerLine
              label="Order Route"
              value={brokerStatus?.orderRoute === "kite" ? "Kite" : "Simulator"}
              state={brokerStatus?.orderRoute === "kite" ? "warning" : "active"}
            />
            <BrokerLine
              label="Stream"
              value={brokerStatus?.stream?.state ?? "idle"}
              state={brokerStatus?.stream?.state === "open" && !brokerStatus.stream.stale ? "active" : "neutral"}
            />
            <BrokerLine
              label="Telegram"
              value={brokerStatus?.notifications?.telegramConfigured ? "Configured" : "Not set"}
              state={brokerStatus?.notifications?.telegramConfigured ? "active" : "neutral"}
            />
            <BrokerLine
              label="Rate Limit"
              value={rateLimitDelayed ? `${rateLimitDelayed} delays` : "Clear"}
              state={rateLimitDelayed ? "warning" : "active"}
            />
            <BrokerLine
              label="Live Orders"
              value={brokerStatus?.liveOrders === "armed" ? "Armed" : "Locked"}
              state={brokerStatus?.liveOrders === "armed" ? "warning" : "active"}
            />
          </div>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Zerodha Login" icon={<KeyRound size={18} />}>
          <div className="token-box">
            <label>
              <span>Request Token</span>
              <input
                type="text"
                value={requestToken}
                placeholder="Paste request_token"
                autoComplete="off"
                onChange={(event) => setRequestToken(event.target.value)}
                disabled={!brokerStatus?.apiConfigured || brokerBusy}
              />
            </label>
            <div className="report-actions">
              <button className="mini-action" type="button" onClick={openZerodhaLogin} disabled={!canUseKiteAuth}>
                <ExternalLink size={16} aria-hidden="true" />
                <span>Open Kite</span>
              </button>
              <button className="mini-action" type="button" onClick={connectZerodhaSession} disabled={!canConnectKite}>
                <KeyRound size={16} aria-hidden="true" />
                <span>Connect</span>
              </button>
            </div>
            <p className={brokerStatus?.apiConfigured ? "broker-note" : "broker-note warning"}>
              {brokerMessage ||
                (brokerStatus?.apiConfigured
                  ? "Daily login is required before live API use. This app still routes orders to paper mode."
                  : "Add Kite keys in .env, then restart the API server.")}
            </p>
          </div>
        </Panel>
      </div>
    </section>
  );

  const labView = (
    <section className="cockpit-grid">
      <div className="stack">
        <Panel title="Backtest Lab" icon={<FlaskConical size={18} />}>
          <div className="strategy-grid">
            <div>
              <span>Trades</span>
              <strong>{backtest?.trades ?? 0}</strong>
            </div>
            <div>
              <span>Win Rate</span>
              <strong>{backtest?.winRate ?? 0}%</strong>
            </div>
            <div>
              <span>Net P&L</span>
              <strong className={(backtest?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {formatCurrency(backtest?.netPnl ?? 0, 2)}
              </strong>
            </div>
            <div>
              <span>Drawdown</span>
              <strong className="loss">{formatCurrency(backtest?.maxDrawdown ?? 0, 2)}</strong>
            </div>
            <div>
              <span>Sharpe</span>
              <strong>{(backtest?.sharpeRatio ?? 0).toFixed(2)}</strong>
            </div>
            <div>
              <span>Profit Factor</span>
              <strong>{(backtest?.profitFactor ?? 0).toFixed(2)}</strong>
            </div>
            <div>
              <span>Avg Win</span>
              <strong className="gain">{formatCurrency(backtest?.avgWin ?? 0, 2)}</strong>
            </div>
            <div>
              <span>Avg Loss</span>
              <strong className="loss">{formatCurrency(backtest?.avgLoss ?? 0, 2)}</strong>
            </div>
          </div>
          <div className="report-actions">
            <button className="mini-action" type="button" onClick={runBacktestNow} disabled={backtestBusy}>
              <Activity size={16} aria-hidden="true" />
              <span>{backtestBusy ? "Running" : "Run Test"}</span>
            </button>
            <button className="mini-action" type="button" onClick={() => refreshServerIntelligence()}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Load Latest</span>
            </button>
          </div>
          <p className={serverMessage ? "broker-note" : "broker-note warning"}>
            {serverMessage || "Backtests use Kite historical candles when connected, otherwise simulator candles."}
          </p>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Walk-Forward Validation" icon={<Scale size={18} />}>
          <p className="broker-note">
            The professional-grade engine replays the exact live strategy over stored historical candles. Sync candles
            once (POST /api/backtest/sync-candles), then run POST /api/backtest/walk-forward. The Verdict tab uses the
            out-of-sample result. The CSV report is at /api/backtest/walk-forward/latest.csv.
          </p>
        </Panel>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <aside className="sidebar">
        <div>
          <div className="brand-lockup" aria-label="Aindra Trader">
            <div className="brand-mark">
              <Bot size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Algo Desk</p>
              <h1>Aindra</h1>
            </div>
          </div>
          <span className={`mode-badge ${brokerStatus?.liveOrders === "armed" ? "live" : "paper"}`}>
            {brokerStatus?.liveOrders === "armed" ? "LIVE" : "PAPER"}
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="Application sections">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              onClick={() => setActiveView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div
            className={`sidebar-pill ${engineHealthy ? "ok" : "warn"}`}
            title={paperState?.heartbeat.lastTickAt ? `Last engine tick: ${paperState.heartbeat.lastTickAt}` : "Engine not ticking"}
          >
            <span className="dot" />
            <span>{engineHealthy ? "Engine Live" : "Engine Idle"}</span>
          </div>
          <div className={`sidebar-pill ${brokerOnline ? "ok" : "warn"}`}>
            <span className="dot" />
            <span>{brokerOnline ? "API Online" : "API Offline"}</span>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="app-header">
          <div className="header-title">
            <p className="eyebrow">NSE Equity Intraday</p>
            <h2>{SECTION_TITLES[activeView]}</h2>
          </div>

          <div className="pnl-ticker">
            <span>Net P&L</span>
            <strong className={dayPnl >= 0 ? "gain" : "loss"}>{formatCurrency(dayPnl, 2)}</strong>
          </div>

          <div className="top-actions">
            <div className={`market-pill ${riskState?.marketOpen ? "open" : "closed"}`}>
              <Radar size={14} aria-hidden="true" />
              <span>{marketStatusLabel}</span>
            </div>
            <div className={`status-pill ${sim.status}`}>
              <Bot size={14} aria-hidden="true" />
              <span>{statusLabel(sim.status)}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          </div>
        </header>

        <main className="workspace">
          {activeView === "trade"
            ? tradeView
            : activeView === "markets"
              ? marketsView
              : activeView === "risk"
                ? riskView
                : activeView === "broker"
                  ? brokerView
                  : activeView === "lab"
                    ? labView
                    : activeView === "history"
                      ? (
                          <HistoryView
                            tradeHistory={tradeHistory}
                            historyError={historyError}
                            onRefresh={() => refreshTradeHistory()}
                            onExport={exportTradeHistory}
                          />
                        )
                      : activeView === "verdict"
                        ? <VerdictView verdict={verdict} onRefresh={() => refreshVerdict()} />
                        : (
                            <AnalyticsView
                              analytics={analytics}
                              tradeQuality={tradeQuality}
                              analyticsError={analyticsError}
                              onRefresh={() => refreshAnalytics()}
                              onExport={exportAnalytics}
                            />
                          )}
        </main>
      </div>
    </div>
  );
}

export default App;
