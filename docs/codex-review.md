# Codex Review — Handoff for Analysis (captured 2026-06-15)

This file captures a parallel review the user ran with Codex (another AI), so a
fresh session can analyze it. Screenshots do not carry across sessions; this is
the faithful text. The user wants the ANALYSIS done in a new session, not in the
thread where this was captured.

To analyze in the new session, read this file plus `docs/LAB_NOTES.md` (our own
backtest evidence) and `docs/PDD_AND_ALGORITHM.md` (architecture).

---

## What Codex was asked, and what it answered

### 1. Is 1 trade/day better than what we used earlier?
Codex agreed: yes. It cited the same maxTrades sweep we ran (1 → −2,523 / PF
0.67 / exp −60; 2 → −4,366 / 0.63 / −63; 3 → −5,821 / 0.56 / −75) and the
walk-forward (maxTrades=1 better/equal in all 6 folds). Crucially Codex
stressed: **1 trade/day is not proof of profitability — it is just less bad;
"halves the bleed" but still negative OOS.** Recommend keep maxTrades=1, paper
to ≥30 closed trades, then judge expectancy. Consistent with our conclusion.

### 2. How many trades do people use in algo trading?
No standard number; depends on style. Rough map: long-term = few/month;
swing = few/week; intraday directional = 1–5/day; scalping = 10–100+/day;
HFT/market-making = hundreds–thousands/day. For retail intraday with normal
costs, low frequency (1–3 good trades/day) usually works better. The real
question is net expectancy after costs, not trade count. Recommended max
trades/day by phase: paper-testing weak/unknown edge = 1; proven positive edge
= 2–3; scalp/stat-arb with strong cost control = 5+. → 1/day is a disciplined
testing setting, not "too low."

### 3. Which style are we using?
Low-frequency intraday directional algo (retail NSE equity intraday
momentum/pullback). Not HFT, market-making, scalping, or swing. Scans a
watchlist, looks for opening-range breakout / VWAP pullback / momentum /
relative strength, picks the best qualifying signal, one position at a time,
exits via stop/target/trailing/square-off, currently 1 trade/day.

### 4. Why only this style and not all?
Each style needs a different machine underneath; mixing makes the strategy
messy, hard to test, dangerous. Current app design suits intraday directional
(5-min candles, Zerodha retail execution, one position, stop/target/trailing,
same-day square-off, watchlist scanning). We already use multiple intraday
directional FAMILIES (opening range, VWAP pullback, momentum, RS) — same broad
style. Other styles are excluded for now because each needs different
infrastructure (scalping → fast exec/tight spreads/low costs; HFT/MM →
order-book data, colocation; swing → overnight holding, gap risk, portfolio,
news/corp-action, different backtests; long-term → daily/weekly data,
allocation, fundamentals; options → Greeks, expiry, IV, margin, liquidity).
Main reason: **edge measurement becomes impossible if everything is mixed too
early.** Best path: prove one style → make it stable → add another as a
separate module → give each its own risk budget and performance report.

### 5. Which style is best?
No universally best style; the best is the one with positive expectancy after
brokerage, taxes, spread, slippage, execution limits. Codex's retail ranking:
1. **Low-frequency swing/positional equity** — fewer trades, lower cost
   pressure, less latency dependence (easiest retail odds).
2. **Low-frequency intraday directional** — what Aindra uses; no overnight risk.
3. Options strategies — powerful but complex (Greeks, expiry, IV, margin).
4. Scalping — tiny edge eaten by spread/slippage/charges.
5. HFT / market making — institutions only.

### 6. Why did we choose intraday if swing ranks higher?
Because the app was originally shaped around intraday (no overnight holdings,
same-day square-off, daily Zerodha login, 5-min candles, live dashboard, one
position, paper trading with immediate feedback) — that made intraday
directional the natural first build, NOT because intraday is the best retail
style. If the question is "what style has the best retail odds after costs?",
**swing/positional equity deserves to be built earlier** (lower cost pressure,
no ultra-fast execution needed). It wasn't first only because it needs a
different engine:

| Intraday engine (current) | Swing/positional engine (proposed) |
|---|---|
| 5-min candles | daily/hourly candles |
| close same day | hold for days/weeks |
| one position | portfolio of positions |
| intraday stop/target | gap risk, trailing exits, EOD rules |
| daily P&L lock | portfolio drawdown / risk model |
| broker session active during market | durable multi-day position sync |

**Codex's headline recommendation:** keep the current intraday module as
experimental, but **build a separate swing/positional module next** — not mixed
into the same logic. Separate strategy, separate backtest, separate risk rules,
separate performance report. "Cleaner chance to find real edge instead of
forcing one engine to do everything."

---

## How this aligns with our own findings (docs/LAB_NOTES.md)

- Agreement: maxTrades=1 is loss-reduction, not edge; strategy still negative
  OOS; keep paper-testing; do not go live.
- Agreement: don't mix styles before proving one (we reached the same via the
  "no edge anywhere in the intraday parameter space" result).
- New angle Codex adds that our lab did NOT test: **whether a different STYLE
  (swing/positional, daily/hourly bars, multi-day holds) has edge** — our lab
  only swept intraday parameters/timeframes (5m/15m/30m, all intraday). Codex
  argues the asset-class/holding-horizon choice may matter more than any
  intraday tuning. This matches the honest take already given in-thread:
  intraday large-cap is near-efficient for retail; swing/positional is where
  retail odds are structurally better.

## Open questions for the new session to analyze

1. Is Codex right that swing/positional is the better next build? What does the
   evidence (ours + general) say, and what would it cost to build/validate?
2. Should the intraday bot keep running on paper in parallel (it's free
   evidence + system validation) while a swing module is built?
3. What is the minimum viable swing/positional module that reuses what we
   already have (candle store, backtest engine, walk-forward, verdict, risk
   guard, durable positions) vs. what genuinely needs new code?
4. Does anything in Codex's reasoning conflict with our lab evidence or contain
   a flaw? (e.g. it leans on style-ranking heuristics, not Aindra-specific
   backtests — swing edge is asserted, not yet measured here.)
