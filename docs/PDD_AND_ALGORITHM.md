# Aindra Trader PDD And Algorithm Handoff

Last updated: 2026-06-11

This document is a handoff for continuing development of Aindra Trader. It describes the product intent, current architecture, trading algorithm, risk model, runtime behavior, data model, and recommended next improvements.

Important: this system is still a paper-first trading research and execution framework. It is not a proven profitable strategy. Do not enable live orders until the paper results and analytics show a statistically credible edge over many sessions.

## 1. Product Design Document

### 1.1 Product Name

Aindra Trader

### 1.2 Product Goal

Build a clean, futuristic, light/dark intraday trading dashboard for the Indian NSE equity market that can:

- Connect to Zerodha Kite for market data.
- Run an automated paper trading bot during market hours.
- Pick one qualifying stock setup from a watchlist.
- Place paper entries and exits automatically.
- Stop or lock trading when daily risk limits are reached.
- Show all open positions, trade history, P&L, strategy diagnostics, and analytics.
- Keep live order execution locked unless explicitly enabled later.

### 1.3 Current Operating Mode

The current system is paper trading only by default.

- Zerodha market data can be real via Kite WebSocket/REST.
- Orders are routed to the local simulator/paper ledger.
- Live orders are locked unless `LIVE_TRADING_ENABLED=true` is set in `.env`.
- Even if live is enabled, server-side risk guards still validate order safety.

### 1.4 Target User

Primary user:

- Retail Indian market trader testing systematic intraday strategies.
- Wants an automated bot but does not want to manually select symbols.
- Needs a dashboard that is simple enough to operate daily.
- Needs evidence and analytics before trusting real money.

Secondary developer/user:

- Developer improving strategy logic, analytics, backtests, cloud hosting, and later live trading.

### 1.5 Key Product Principles

1. Paper first.
2. Real market data before real orders.
3. Risk guard before alpha.
4. Evidence collection before machine learning.
5. No hidden live trading.
6. Hard refresh or app restart should not lose backend paper state.
7. Market closed/pre-open state must be visible.
8. Live order capability must be opt-in and heavily guarded.

### 1.6 Current Default Configuration

Defined in:

- `src/App.tsx`
- `server/index.js`

Current defaults:

```text
capital: 50000
targetPct: 1
maxLossPct: 0.5
maxTrades: 2
slippageBps: 8
minScore: 70
minMomentumPct: 0.1
maxSpreadBps: 18
riskPerTradePct: 0.25
stopLossPct: 0.8
takeProfitPct: 1.6
atrStopMultiplier: 1.5
minRelativeStrengthPct: 0.05
minNetRewardRisk: 1.2
strategyMode: hybrid
```

Meaning:

- Daily paper capital: INR 50,000
- Daily target: INR 500
- Daily max loss: INR 250
- Risk per trade: INR 125
- Maximum entries per day: 2
- Slippage assumption: 8 bps each side

### 1.7 In-Scope Features Already Built

Frontend:

- Dashboard view
- Trade History view
- Analytics view
- Light/dark theme
- Market status pill
- Bot status pill
- Risk Engine controls
- Strategy Scanner
- Open Position panel
- Strategy Brain panel
- Broker Boundary panel
- Zerodha Login panel
- Execution Quality panel
- Backtest Lab
- Daily Reports
- Trade Journal
- CSV exports

Backend:

- Zerodha login URL and session creation
- Kite REST quotes and historical candles
- Kite WebSocket stream
- REST fallback when stream depth is stale/missing
- Strategy signal generation
- Paper order ledger
- Live order route, locked by default
- Risk guard
- Market calendar guard
- Backtesting
- Trade history reconstruction
- Signal snapshot logging
- Analytics aggregation
- JSONL event storage
- Rate limiting
- Duplicate paper order protection

### 1.8 Out Of Scope For Current Version

Not currently built or not yet validated:

- Proven profitability
- Real-money autonomous deployment
- Multi-account trading
- Options/futures trading
- Portfolio correlation controls
- Full NSE universe scanner
- ML/XGBoost/LightGBM model
- Walk-forward optimizer
- Cloud/VPS production deployment
- Notifications/alerts
- Broker failover
- Persistent SQL database
- Audited live order recovery after app/server crash

### 1.9 Market Hours Logic

Implemented in `server/marketCalendar.js`.

Indian equity session assumptions:

```text
Pre-open/arm window: before 09:15
Market open: 09:15 to 15:30
Fresh entries: 09:20 to 15:00
Square-off due: after 15:15
No fresh entries after 15:00
Weekends blocked
Configured holidays blocked through NSE_HOLIDAYS
```

The UI allows arming before the market opens if `botArmAllowed` is true. Fresh entries only happen when `freshEntriesAllowed` is true.

## 2. Repository Map

```text
src/App.tsx
  Main React application. UI state, paper runtime loop, resume logic, controls, dashboard, history, analytics.

src/styles.css
  App styling, light/dark theme, dashboard layout, analytics tables.

src/main.tsx
  React app bootstrap.

server/index.js
  HTTP API server, config parsing, route wiring, strategy payload generation, signal logging.

server/strategy.js
  Core signal generation, indicators, strategy scoring, market regime, relative strength, sizing, agent decision.

server/riskGuard.js
  Daily risk state, kill switch, order validation, market-session validation.

server/orders.js
  Paper/live order handling, dedupe, event writing, trade history reconstruction.

server/analytics.js
  Aggregates trade and signal analytics from JSONL events.

server/backtester.js
  Simple historical/simulated candle backtest engine.

server/marketData.js
  Mock/Kite quote and candle fetch logic.

server/marketStream.js
  Kite WebSocket stream wrapper.

server/kiteClient.js
  Kite REST client, login URL, session, quote, historical, orders.

server/marketCalendar.js
  NSE market timing and entry/square-off windows.

server/watchlist.js
  Current static watchlist and market context symbols.

server/database.js
  Local JSON and JSONL persistence under `.aindra-data`.

server/rateLimiter.js
  API rate limit helper.

tools/build_algorithm_doc.py
  Script used to generate the Word algorithm documentation.
```

## 3. Runtime Architecture

### 3.1 Frontend Runtime

The frontend runs with Vite:

```powershell
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Frontend calls backend through Vite proxy:

```text
/api -> http://127.0.0.1:8787
```

### 3.2 Backend Runtime

Backend runs with:

```powershell
npm run api
```

Default backend:

```text
http://127.0.0.1:8787
```

### 3.3 Data Persistence

Local runtime data lives under:

```text
.aindra-data/
```

Important files:

```text
events.jsonl
  Append-only event ledger for market snapshots, signals, orders, analytics source data.

kite-session.json
  Daily Zerodha access token and profile. Ignored by git.

risk-state.json
  Daily P&L, trades taken, kill switch state.

order-dedupe.json
  Prevents duplicate paper/live order posting from repeated UI/server calls.

latest-backtest.json
  Latest backtest result shown in the UI.

instrument-cache.json
  Kite instrument tokens for watchlist symbols.
```

Secrets:

```text
.env
```

is ignored by git.

Safe template:

```text
.env.example
```

is committed.

## 4. API Surface

Current important routes:

```text
GET  /api/health
GET  /api/broker/status
GET  /api/market/calendar
GET  /api/market/stream/status
GET  /api/broker/zerodha/login-url
POST /api/broker/zerodha/session
POST /api/broker/zerodha/sync-instruments
GET  /api/market/watchlist
GET  /api/market/quotes
GET  /api/market/candles
GET  /api/strategy/signals
POST /api/backtest/run
GET  /api/backtest/latest
GET  /api/risk/state
POST /api/risk/kill-switch
POST /api/orders/paper
POST /api/orders/live
GET  /api/orders
GET  /api/trade-history
GET  /api/analytics/performance
GET  /api/events
```

## 5. Trading Algorithm Specification

Core file:

```text
server/strategy.js
```

### 5.1 Data Inputs

Per symbol quote fields:

```text
symbol
name
sector
ltp
open
high
low
close
volume
bestBid
bestAsk
spreadBps
source
```

Per symbol candles:

```text
time
open
high
low
close
volume
```

Market context:

```text
NIFTY 50 quote
NIFTY 50 candles
```

Current watchlist:

```text
RELIANCE
HDFCBANK
ICICIBANK
INFY
TCS
SBIN
AXISBANK
LT
BHARTIARTL
MARUTI
TITAN
ULTRACEMCO
NIFTY 50 as index context
```

### 5.2 Indicators

VWAP:

```text
typicalPrice = (high + low + close) / 3
vwap = sum(typicalPrice * volume) / sum(volume)
```

ATR:

```text
trueRange = max(
  high - low,
  abs(high - previousClose),
  abs(low - previousClose)
)
atr = average(trueRange over latest 14 periods)
```

Volume pulse:

```text
volumePulse = latestVolume / averageVolume(last 20 candles)
```

SMA:

```text
sma = average(values)
```

Standard deviation:

```text
stddev = sqrt(average((value - mean)^2))
```

RSI:

Current implementation is simple average gain/loss over the lookback, not Wilder smoothing.

```text
RS = gains / losses
RSI = 100 - 100 / (1 + RS)
```

Bollinger bands:

```text
middle = SMA(last 20 closes)
upper = middle + 2 * stddev
lower = middle - 2 * stddev
```

Opening range:

```text
openingRange = first min(6, candleCount) candles passed to strategy
rangeHigh = max(high)
rangeLow = min(low)
```

### 5.3 Market Regime Detection

Function:

```text
detectMarketRegime({ niftyBias, niftyCandles })
```

Inputs:

```text
niftyBias = ((NIFTY ltp - NIFTY previous close) / previous close) * 100
niftyTrendPct = candle move over about 12 candles when available
niftyAtrPct = NIFTY ATR / latest NIFTY close * 100
```

Classification:

```text
bias:
  bullish if combinedTrend > 0.18
  bearish if combinedTrend < -0.18
  neutral otherwise

volatility:
  high if atrPct > 0.35
  normal if atrPct > 0.18
  low otherwise

state:
  volatile if volatility is high
  trend if abs(combinedTrend) >= 0.45
  sideways if abs(combinedTrend) <= 0.12
  mixed otherwise
```

Output example:

```json
{
  "state": "mixed",
  "bias": "bearish",
  "trendPct": -0.40,
  "volatility": "low",
  "atrPct": 0.10,
  "label": "mixed/bearish"
}
```

### 5.4 Relative Strength

For every stock:

```text
dayMomentumPct = ((stock ltp - stock previous close) / stock previous close) * 100
niftyBiasPct = ((NIFTY ltp - NIFTY previous close) / NIFTY previous close) * 100
relativeStrengthPct = dayMomentumPct - niftyBiasPct
```

Direction-adjusted relative strength:

```text
Long setup: directionalRS = relativeStrengthPct
Short setup: directionalRS = -relativeStrengthPct
```

Gate:

```text
directionalRS >= minRelativeStrengthPct
```

Default:

```text
minRelativeStrengthPct = 0.05
```

Mean reversion is allowed to bypass the relative-strength gate.

### 5.5 Strategy Families

The system evaluates eight candidate strategies:

Long:

```text
Momentum
Mean Reversion
VWAP Pullback
Opening Range Breakout
```

Short:

```text
Short Momentum
Short Mean Reversion
Short VWAP Pullback
Opening Breakdown
```

The selected strategy is:

```text
if strategyMode == hybrid:
  select highest scoring candidate
else:
  select candidate matching selected mode
```

### 5.6 Candidate Scoring

Each strategy returns a candidate score from 0 to 100.

Factors used across strategies:

```text
short-term candle momentum
day momentum
relative strength vs NIFTY
volume pulse
NIFTY bias
market regime bias
VWAP relationship
Bollinger band distance
RSI
opening range breakout/breakdown
SMA relationship
```

Examples:

Momentum long rewards:

```text
positive short momentum
positive day momentum
positive relative strength
volume pulse
bullish/neutral NIFTY bias
above VWAP
```

Short momentum rewards:

```text
negative short momentum
negative day momentum
negative relative strength
volume pulse
bearish/neutral NIFTY bias
below VWAP
```

Mean reversion long rewards:

```text
low RSI
price near or below lower Bollinger band
volume pulse
low absolute NIFTY trend
sideways regime bonus
```

Opening breakdown rewards:

```text
price below opening range low
negative relative strength
volume pulse
negative day momentum
bearish regime
below short SMA
```

### 5.7 Final Signal Score

After strategy candidate selection, final score is a weighted composite:

```text
spreadScore:
  up to 14 points

strategyScore:
  selectedStrategy.score * 0.5
  up to 50 points

indexScore:
  based on direction-adjusted NIFTY bias
  up to 10 points

relativeStrengthScore:
  based on direction-adjusted relative strength
  up to 16 points

volatilityScore:
  penalizes high ATR relative to price
  up to 10 points

regimeScore:
  10 if market regime supports side/mode
  6 if neutral
  0 otherwise
```

Then:

```text
score = clamp(round(sum), 0, 100)
```

Default minimum:

```text
minScore = 70
```

### 5.8 Regime Support Gate

Function:

```text
regimeSupportsSignal(regime, side, mode)
```

Logic:

```text
Mean reversion:
  allowed if regime is not trend OR bias is neutral

Momentum/VWAP/Opening:
  if regime bias is neutral, allowed
  long allowed only if bias is bullish
  short allowed only if bias is bearish
```

This is designed to avoid long momentum in a bearish market and short momentum in a bullish market.

### 5.9 Position Sizing

Function:

```text
sizePosition({ price, atrValue, config, side })
```

Risk amount:

```text
riskAmount = capital * riskPerTradePct / 100
```

Default:

```text
capital = 50000
riskPerTradePct = 0.25
riskAmount = 125
```

Stop distance:

```text
percentStopDistance = price * stopLossPct / 100
atrStopDistance = ATR * atrStopMultiplier
minimumStopDistance = price * 0.004

stopDistance = max(percentStopDistance, atrStopDistance, minimumStopDistance)
```

Defaults:

```text
stopLossPct = 0.8
atrStopMultiplier = 1.5
minimum floor = 0.4% of price
```

Quantity:

```text
capitalCapQuantity = floor((capital * 0.96) / price)
riskQuantity = floor(riskAmount / stopDistance)
quantity = min(capitalCapQuantity, riskQuantity)
```

Target distance:

```text
targetDistance = max(price * takeProfitPct / 100, stopDistance * 1.4)
```

Default:

```text
takeProfitPct = 1.6
minimum reward = 1.4R before charges/slippage
```

Stop/target prices:

```text
Long:
  stopLossPrice = price - stopDistance
  targetPrice = price + targetDistance

Short:
  stopLossPrice = price + stopDistance
  targetPrice = price - targetDistance
```

### 5.10 Charges And Net Reward/Risk Gate

Charges model:

```text
turnover = buyValue + sellValue
brokerage = min(20, buyValue * 0.0003) + min(20, sellValue * 0.0003)
stt = sellValue * 0.00025
exchangeTxn = turnover * 0.0000297
sebi = turnover * 0.000001
stamp = buyValue * 0.00003
gst = 18% * (brokerage + exchangeTxn + sebi)
charges = brokerage + stt + exchangeTxn + sebi + stamp + gst
```

Round-trip reward estimate includes slippage:

```text
slippage = slippageBps / 10000

Long:
  entry = ltp * (1 + slippage)
  exit = target * (1 - slippage)

Short:
  entry = ltp * (1 - slippage)
  exit = target * (1 + slippage)

grossReward = abs(exit - entry) * quantity
netReward = grossReward - estimatedCharges
netRewardRisk = netReward / positionRisk
```

Gate:

```text
netRewardRisk >= minNetRewardRisk
```

Default:

```text
minNetRewardRisk = 1.2
```

### 5.11 Eligibility Gates

A signal is eligible only when all gates pass:

```text
score >= minScore
strategy is mean-reversion OR directional momentum passes
strategy is mean-reversion OR relative strength passes
market regime supports side/mode
netRewardRisk >= minNetRewardRisk
spreadBps <= maxSpreadBps
ltp <= capital * 0.98
quantity > 0
```

Blocked signals include `gateReasons`, for example:

```text
score 61 < 70
momentum gate
relative strength -0.08%
regime mixed/bearish
net R:R 0.91
spread 22.4 bps
price above capital cap
size below 1 share
```

### 5.12 Agent Decision

Function:

```text
agentDecision(signals, config)
```

Logic:

```text
top = first eligible signal sorted by score
if no eligible signal:
  top = highest score signal
  action = WAIT
  reason = gate reasons
else:
  action = TRADE
  symbol = top.symbol
  side = top.side
  quantity = min(strategy sizing quantity, floor(capital * 0.96 / top.price))
  stopLossPrice = calculated stop
  targetPrice = calculated target
  riskAmount = position risk
  strategy = top.strategy
  score = top.score
```

The agent chooses only one active trade at a time. The UI runtime also blocks new entries if there is already an open position.

## 6. Bot Runtime Flow

Core frontend function:

```text
tickBackendPaper(...)
```

Runs every 7 seconds when:

```text
brokerStatus exists
sim.status == running
```

High-level flow:

```text
1. Fetch strategy payload.
2. Fetch risk state.
3. Apply backend signal prices to local stock state.
4. If app is not running, only update market data.
5. If market is fully closed and bot cannot arm, close positions and stop.
6. Update open position LTP.
7. Calculate unrealized P&L.
8. If daily target or max loss hit, close positions and stop.
9. If square-off window is due, close positions and stop.
10. If stop-loss or target is hit, close that position.
11. If max trades reached, do not enter again.
12. If no open position and strategy decision is TRADE, create paper entry.
13. Post paper order to backend ledger.
14. Refresh trade history, analytics, and strategy state.
```

### 6.1 Entry Price Slippage

Frontend entry price:

```text
Long entry = ltp * (1 + slippageBps / 10000)
Short entry = ltp * (1 - slippageBps / 10000)
```

### 6.2 Exit Price Slippage

Frontend exit price:

```text
Long exit = ltp * (1 - slippageBps / 10000)
Short exit = ltp * (1 + slippageBps / 10000)
```

### 6.3 Position Exit Trigger

```text
Short:
  exit if lastPrice >= stopLoss OR lastPrice <= targetPrice

Long:
  exit if lastPrice <= stopLoss OR lastPrice >= targetPrice
```

### 6.4 Daily Lock Conditions

Bot stops when:

```text
dayPnl >= targetAmount
dayPnl <= -lossAmount
market close guard triggers
square-off due
manual Close Day
kill switch active
```

New entries stop when:

```text
tradesTaken >= maxTrades
freshEntriesAllowed is false
market is closed
score/gates fail
position already open
```

## 7. Resume After Hard Refresh

The app has frontend localStorage, but backend paper order state is the source of truth.

Current resume flow:

```text
1. Frontend loads.
2. Fetches trade history.
3. Fetches strategy signals.
4. Finds today open trades from `/api/trade-history`.
5. Converts open trade rows to active `Position` objects.
6. Uses stored stop/target when available.
7. If legacy trade has no stop/target, recalculates fallback stop/target from entry price and latest signal ATR.
8. Restores tradesTaken from risk state.
9. If token is ready, market is open, and kill switch is clear, status resumes to running.
```

This was added because a browser hard refresh previously lost the visible open position even though the backend ledger still had it.

## 8. Risk Guard

Core file:

```text
server/riskGuard.js
```

Responsibilities:

- Track daily P&L.
- Track trades taken.
- Enforce kill switch.
- Block entries outside market window.
- Block fresh entries after entry window.
- Block trading after max daily loss.
- Block trading after daily target.
- Block trading after max trades.
- Validate live order route is explicitly enabled.
- Validate product/exchange/order details.

Risk state endpoint:

```text
GET /api/risk/state
```

Kill switch:

```text
POST /api/risk/kill-switch
```

## 9. Paper Order Ledger And Trade History

Core file:

```text
server/orders.js
```

Paper orders:

```text
POST /api/orders/paper
```

Events written:

```text
orders.paper
orders.rejected
orders.duplicate
```

Trade reconstruction:

```text
GET /api/trade-history
```

The trade history builder:

- Reads order events.
- Normalizes paper/live/rejected events.
- Infers ENTRY/EXIT if needed.
- Tracks open lots.
- Matches exits to open lots using LIFO.
- Builds closed trades and open trades.
- Computes gross P&L, charges, net P&L, trade return, capital return.
- Summarizes daily P&L and totals.

Open trade rows are used by frontend resume logic.

## 10. Analytics Layer

Core file:

```text
server/analytics.js
```

Endpoint:

```text
GET /api/analytics/performance
```

Uses:

- Trade history from `orders.js`
- Signal snapshots from `events.jsonl`

Signal snapshots are written in `server/index.js` every time `/api/strategy/signals` is called.

Analytics output:

```text
totals:
  closedTrades
  netPnl
  winRate
  charges
  signalSnapshots
  totalSignals
  eligibleSignals
  eligibleRate
  tradeDecisions
  waitDecisions

tradePerformance:
  byStrategy
  bySymbol
  bySide

signalQuality:
  byStrategy
  bySymbol
  bySide
  byRegime
  recent
```

This layer exists so future development can prove or disprove edge with data.

## 11. Backtesting

Core file:

```text
server/backtester.js
```

Endpoint:

```text
POST /api/backtest/run
GET  /api/backtest/latest
```

Backtest flow:

```text
1. Iterate selected watchlist symbols.
2. Slice historical/simulated candles progressively.
3. Build synthetic quote from latest candle.
4. Call generateSignals().
5. If top signal eligible, size position.
6. Enter with slippage.
7. Look forward several candles.
8. Exit on stop, target, or time-exit.
9. Deduct charges.
10. Track net P&L, win rate, drawdown, expectancy, Sharpe, profit factor, average win/loss, loss streaks.
```

Current limitation:

The backtest is useful for sanity checks but is not a professional-grade walk-forward engine.

## 12. Zerodha Integration

Core files:

```text
server/kiteClient.js
server/marketStream.js
server/marketData.js
server/index.js
```

Daily login:

```text
1. User clicks Open Kite.
2. Backend returns Kite login URL.
3. User logs into Zerodha.
4. Zerodha redirects with request_token.
5. User pastes token into UI.
6. Backend exchanges request_token for access token.
7. Token saved in `.aindra-data/kite-session.json`.
8. WebSocket stream starts after instrument sync.
```

Data source priority:

```text
1. Kite WebSocket if token ready and stream fresh.
2. Kite REST quote fallback.
3. Simulator if token missing or Kite request fails.
```

Order route:

```text
LIVE_TRADING_ENABLED=false:
  orderRoute = simulator

LIVE_TRADING_ENABLED=true:
  orderRoute = kite, but only after validations
```

## 13. Known Limitations And Risks

### 13.1 Strategy Edge Is Not Proven

The algorithm is rule-based. It is not yet statistically proven. Current focus should be evidence collection.

### 13.2 Scoring Is Still Heuristic

Scoring has been improved with relative strength, regime, and net R:R, but weights are still manually chosen.

### 13.3 Watchlist Is Small And Static

Only 12 stocks are scanned. This can miss better opportunities.

### 13.4 No Sector Strength Engine Yet

Sectors are displayed, but sector rotation is not yet computed.

### 13.5 No Advance/Decline Or VIX

Market context currently uses NIFTY only. Bank Nifty, India VIX, and breadth are not implemented.

### 13.6 One Position At A Time

This is intentional for small-capital paper testing. Multi-position logic should wait for correlation controls.

### 13.7 No Professional Walk-Forward Validation

The current backtest is not enough for live deployment.

### 13.8 Intraday Shorting Constraint

Short positions are paper-mode signals. In real NSE equity MIS, shorts must be intraday only and must be squared off. Broker and exchange constraints must be validated before live use.

### 13.9 Local Runtime Risk

If laptop/internet/browser/backend stops, automation can stop. Cloud/VPS is needed for real autonomous operation.

## 14. Recommended Development Roadmap

### Phase 1: Stabilize Paper Runtime

- Make backend, not frontend, own the paper bot runtime.
- Add a durable `positions.json` or SQL table.
- Add explicit order/position state machine.
- Add heartbeat/status monitor.
- Add automatic recovery after server restart.
- Add clear "paper/live" banner everywhere.

### Phase 2: Better Analytics

- Trade outcome by strategy, symbol, side, hour, regime, spread bucket, relative strength bucket.
- Target-hit frequency: 0.25%, 0.5%, 0.75%, 1%.
- MFE/MAE per trade.
- Time in trade.
- Slippage estimate vs actual.
- Charges as percent of gross.
- Daily drawdown curve.

### Phase 3: Improve Signal Quality

- Better NIFTY candles/session reset.
- Sector strength rankings.
- Relative strength ranking across entire watchlist.
- Bank Nifty confirmation for bank stocks.
- Advance/decline ratio.
- India VIX filter.
- Gap-open handling.
- Avoid stale VWAP/candle windows.
- Strategy-specific target/stop profiles.

### Phase 4: Better Backtesting

- Store historical candles locally.
- Backtest exact same strategy code over many days.
- Add train/test date split.
- Walk-forward validation.
- Parameter sweeps with overfit warnings.
- Export reports to CSV.

### Phase 5: Cloud Deployment

- Move backend to VPS.
- Keep frontend as client only.
- Use process manager such as PM2 or Docker.
- Add uptime monitor.
- Add secret manager/env config.
- Add daily token/login workflow.
- Add logs and backups.

### Phase 6: Live Trading Readiness

Only after months of paper evidence:

- Add live dry-run mode.
- Add tiny-capital live test.
- Add broker order reconciliation.
- Add real position sync from Zerodha.
- Add emergency square-off.
- Add duplicate order protection across restarts.
- Add live incident audit log.

### Phase 7: ML/AI Layer

Only after enough labeled trades/signals:

- Build feature store.
- Label whether target hit before stop.
- Train baseline logistic regression/random forest first.
- Then consider XGBoost/LightGBM.
- Compare ML vs rule baseline.
- Do not let ML place trades until it beats rule baseline out-of-sample.

## 15. Suggested Claude Tasks

If Claude is continuing this repo, recommended first tasks:

1. Move bot runtime from frontend `tickBackendPaper` into backend service.
2. Add persistent paper positions endpoint:

```text
GET /api/paper/positions
POST /api/paper/start
POST /api/paper/pause
POST /api/paper/close-day
```

3. Add SQL or SQLite persistence instead of only JSONL reconstruction.
4. Update README defaults to match current 50,000 capital profile.
5. Add unit tests for:

```text
sizePosition
charges
tradeHistory reconstruction
marketCalendar
riskGuard validation
restorePositionsFromOpenTrades
```

6. Add sector strength engine.
7. Add MFE/MAE analytics.
8. Add robust backtest report by strategy/regime.

## 16. Key Safety Notes For Claude

- Do not enable live trading by default.
- Do not commit `.env` or `.aindra-data`.
- Do not remove risk guard checks.
- Do not remove market calendar checks.
- Do not place live orders during development.
- Treat all "AI" as decision support until statistical validation exists.
- Keep `LIVE_TRADING_ENABLED=false` unless the user explicitly asks to test live mode and understands the risk.

## 17. Current Project Status

As of this handoff:

- Frontend and backend build successfully.
- GitHub remote is `https://github.com/PrajeetJain/Algo-Trading.git`.
- Branch is `main`.
- Paper mode is the default.
- Zerodha token must be connected daily.
- Open paper positions now restore after hard refresh from backend trade history.
- Analytics tab is available and reads signal snapshots plus trade history.
- Live order path exists but is locked by default.

