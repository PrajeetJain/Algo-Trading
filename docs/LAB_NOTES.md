# Strategy Lab Notes

Running log of backtest experiments. Every entry: hypothesis, result, decision.
Data: 42 trading days of real Kite 5-minute candles (2026-04-13 to 2026-06-12),
26 symbols + NIFTY 50. Replays use the exact live strategy code, worst-case
intra-candle ordering (stop before target), 10 bps assumed spread, 8 bps
slippage per side unless noted. Config base: Rs 2L capital, 0.25% risk/trade,
max 3 trades/day, 1% day stop/target.

Lab runner: `tools/lab.mjs` — run from a sandbox copy of `.aindra-data` so
experiments never touch the live ledger.

## Session 2026-06-12 (first walk-forward + repair iteration)

### Baseline (pre-fix code, S0.8/T1.6)

- Walk-forward (6 folds): OOS **-11,416** over 30 test days, 73 trades, 26%
  win, no overfit warning — honest, consistent loss.
- Full replay: **-14,240**, 103 trades, PF 0.40. Exits: 73 stop-loss (71%),
  4 target (4%), 25 square-off (~flat). vwap-pullback took 49 trades at 16%
  win (-8,077); mean-reversion took 0 trades.

### Defects found and fixed in code

1. **VWAP-pullback chased extended stocks** — scored 20 pts for being
   anywhere above VWAP. Fixed: proximity-weighted (full points at VWAP,
   zero 0.4% away). Effect: family trades 49 -> 21, family net -8,077 ->
   -3,130.
2. **Mean-reversion structurally locked out** — dip-buying always has
   negative directional RS, so its composite could never reach minScore.
   Fixed: inverted RS contribution (capped 12) for that family.

### Geometry sweep (post-fix code)

| Config | Net | Trades | Win | PF | Exp/trade |
|---|---|---|---|---|---|
| S0.5 / T0.75 | -30,611 | 119 | 24% | 0.25 | -257 |
| S0.6 / T0.9 | -25,816 | 116 | 24% | 0.29 | -223 |
| S0.7 / T1.0 | -19,014 | 109 | 28% | 0.37 | -174 |
| S0.7 / T3.0 (trail-only) | -17,915 | 103 | 27% | 0.37 | -174 |
| S0.8 / T1.6 (old default) | -14,800 | 103 | 27% | 0.43 | -144 |
| S1.0 / T1.5 | -10,872 | 93 | 27% | 0.44 | -117 |
| S1.2 / T1.8 | -5,821 | 78 | 31% | 0.56 | -75 |
| S1.5 / T2.25 | -5,039 | 62 | 31% | 0.51 | -81 |
| S2.0 / T2.5 | -1,702 | 49 | 35% | 0.67 | -35 |

**Monotone gradient: tighter stops lose more.** Stops at 5-min granularity
harvest noise against the position. As stops widen, results converge to
"entries minus costs" (square-off exits ~flat), i.e. the entries carry
~zero gross directional edge.

### Other hypotheses tested

- **Mean-reversion-only mode**: -10,528, 21% win. The market was not simply
  "fading strength" — wrong-direction inversion is not the answer.
- **minScore 80**: identical to minScore 70 (-14,207 vs -14,800, same 103
  trades). The composite score does not discriminate outcomes — important
  input for the future ML layer.
- **Realistic costs** (3 bps slippage, S1.2/T1.8): -2,283, PF 0.81, 38% win.
  ~Rs 44/trade of the measured loss is the pessimistic slippage assumption.
  Opening-range was the only family net-positive here (+330, 13 trades).

### Final walk-forward (wide frontier: S in 1.2/1.6/2.0, T in 1.8/2.4)

In-sample daily avg **+17**; out-of-sample **-3,971** (43 trades, 30% win,
-132/day). **Overfit warning raised** — wide geometry can be tuned to look
breakeven in training but does not transfer.

### Conclusions

1. **No configuration of the current signal set shows positive out-of-sample
   expectancy on this window.** The signal families (momentum, VWAP-pullback,
   opening-range, mean-reversion as scored today) have ~zero gross edge at
   5-minute granularity on NSE large caps, Apr-Jun 2026.
2. Adopted anyway (correctness/least-bad): VWAP proximity fix, MR unlock,
   geometry default S1.2/T1.8 (halves the bleed vs old default; mid-frontier,
   not the degenerate S2.0 endpoint).
3. Paper trading continues as **live-vs-lab calibration**, not as profit
   expectation.

## Session 2026-06-15 (iteration 2: timeframe study)

Hypothesis: longer signal timeframes (15m/30m) cut 5-minute noise and reveal
entry edge. Added 5m->Nx candle resampling (day-boundary safe) and made the
opening-range window time-based (09:15-09:45) so it is correct at any
timeframe instead of a hardcoded 6-bar count.

### Timeframe x geometry surface (42 days, full replay, net Rs)

| Geometry | 5m | 15m | 30m |
|---|---|---|---|
| S0.8 / T1.6 | -15,308 | -9,360 | -8,174 |
| S1.2 / T1.8 | -5,821 | -9,360 | - |
| S1.5 / T2.25 | -5,039 | -4,409 | -5,582 |
| S2.0 / T2.5 | -1,702 | -2,276 | -4,526 |

Win rates clustered 22-36%, profit factor 0.30-0.67 everywhere. Square-off
(held-to-EOD) was the dominant exit on every longer-timeframe run and was
net negative — held trades are coin-flips that lose to costs.

### Conclusion (definitive for this window)

**No timeframe x geometry combination is positive.** Longer timeframes
reduce loss ONLY by trading less (fewer cost-bleeding trades) — win rate
does not improve, so there is no entry-edge discovery. The least-bad cell
(5m, S2.0/T2.5, -1,702) is the widest-stop corner, i.e. "rarely stopped =
entries minus costs" — the degenerate endpoint, not a real edge.

The momentum family at wide stops is gross-flat (5m S2.0: +31 over 30
trades; 15m S2.0: -137 over 31). That is the signature of **zero directional
alpha**: entries are ~coin-flips, and every configuration just trades the
cost structure, not an edge.

**Parameter tuning is exhausted.** The problem is the alpha source, not the
configuration. Continuing to sweep parameters would only manufacture
overfit (the wide-frontier walk-forward already raised that warning). No
configuration found is worth deploying real capital to.

### Decisions

- Kept time-based opening range and candle resampling (correctness +
  research tooling — valuable regardless of edge).
- Did NOT move live geometry to the least-bad S2.0 corner: it is still
  negative, and chasing the least-negative widest-stop cell is itself
  overfitting. Live stays at the mid-frontier S1.2/T1.8.
- Paper trading continues for SYSTEM validation and signal-data collection,
  not profit. Expectation: ~breakeven-minus-costs.

## Session 2026-06-15 (iteration 3: trades-per-day, validated)

Trigger: live Day 3 peaked ~+625 then ended -262. Codex first read it as a
profit-protection failure; the per-trade MFE/MAE showed the real cause — the
day's first trade (INFY) won +269 via the trailing stop, then a SECOND trade
(HDFCBANK, MFE=0, bad from entry) lost -531. Hypothesis: later trades are
lower quality.

### maxTrades sweep (42-day replay, S1.2/T1.8)

| maxTrades | Net | Trades | Win% | PF | Expectancy/trade | MaxDD |
|---|---|---|---|---|---|---|
| 1 | -2,523 | 42 | 31% | 0.67 | -60 | -3,173 |
| 2 | -4,366 | 69 | 33% | 0.63 | -63 | -4,759 |
| 3 | -5,821 | 78 | 31% | 0.56 | -75 | -5,901 |

Per-trade expectancy DEGRADES with more trades (-60 -> -63 -> -75): not just
"fewer trades = less bleed" (that would be flat) but genuinely lower-quality
later trades. The first qualifying setup of the day is the best.

### Walk-forward (same geometry grid, 6 folds)

| | maxTrades=1 | maxTrades=3 |
|---|---|---|
| OOS net | -1,619 | -3,972 |
| OOS daily avg | -54 | -132 |
| OOS win rate | 37% | 30% |
| worst fold | -926 | -2,070 |

maxTrades=1 better or equal in ALL 6 folds — robust, not a curve-fit. Both
carry an overfit warning, but that is the geometry grid search (known); the
maxTrades choice is a single structural decision that transferred cleanly.

### Decision

**Adopted maxTrades=1 live** (was 3). Validated OOS, mechanistically sound,
halves the bleed and lifts win rate to 37%. Still NEGATIVE (-54/day OOS) —
this is loss reduction + quality concentration, NOT edge creation. Daily
profit-lock idea deferred: with one trade/day it is largely redundant with
the per-trade trailing stop. Trade-off: ~1 trade/day means ~30 trading days
(6 weeks) to reach the Verdict's 30-trade bar.

### Next research directions (in priority order)

1. **Longer signal timeframe** — 15m/30m bars to cut noise; the 5m gradient
   says noise dominates signal.
2. **Opening-range family deep-dive** — only green family under realistic
   costs; collect more samples, consider making it the primary.
3. **Longer candle history** — sync further back (chunked Kite requests) to
   test across regimes before trusting any conclusion.
4. **Score reconstruction** — minScore showed zero discrimination; rebuild
   scoring from measured feature-outcome correlations (pre-ML step, needs
   the accumulating signal snapshots).
5. **Cost-model calibration** — compare paper fills vs assumed slippage
   after 2-3 weeks; 8 bps may be ~2x too pessimistic for these names.
