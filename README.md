# Aindra Trader

Paper-first intraday trading dashboard for NSE equity testing.

## Run

```powershell
npm install
npm run api
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Open:

```text
http://127.0.0.1:5175
```

## Current Mode

- Paper trading only
- Daily capital defaults to INR 10,000
- Daily target defaults to 2%
- Daily max loss defaults to 1%
- Strategy gates control minimum score, momentum, spread, slippage, and max trades
- Risk-per-trade sizing controls quantity from stop-loss distance
- Strategy modes include Hybrid, Momentum, Mean Reversion, VWAP Pullback, and Opening Range
- Broker boundary is wired to a local API server
- Live Zerodha orders are locked
- Market data uses Kite WebSocket ticks when connected and fresh, Kite REST as fallback, otherwise simulator data
- Server-side strategy agent scores VWAP, momentum, spread, volume pulse, ATR, and Nifty context
- Backtesting includes net P&L, drawdown, Sharpe, profit factor, average win/loss, charges, and loss streaks
- Kill switch and live-order risk guard are available from the dashboard
- API rate limits and duplicate-order protection are enforced server-side
- Market calendar guards block weekends, configured holidays, bad entry windows, and square-off windows
- JSONL event storage is written to `.aindra-data/`

## Zerodha Setup Later

Copy `.env.example` to `.env` and fill:

```text
KITE_API_KEY=
KITE_API_SECRET=
LIVE_TRADING_ENABLED=false
API_PORT=8787
NSE_HOLIDAYS=
```

Keep `LIVE_TRADING_ENABLED=false` until paper trading has passed forward testing.

## Daily Zerodha Login Flow

1. Start the API server with `npm run api`.
2. Start the frontend with `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`.
3. Open the dashboard and use the Zerodha Login panel.
4. Click Open Kite.
5. Complete Zerodha login in the browser.
6. Copy the `request_token` from the redirect URL.
7. Paste it into Request Token and click Connect.

The token is saved locally in `.aindra-data/kite-session.json` for the trading day and expires the next morning.

## API Features

```text
GET  /api/market/quotes
GET  /api/market/calendar
GET  /api/market/stream/status
GET  /api/strategy/signals
POST /api/backtest/run
GET  /api/risk/state
POST /api/risk/kill-switch
POST /api/orders/paper
POST /api/orders/live
```

`/api/orders/live` remains blocked unless all risk checks pass, Kite token is connected, and `LIVE_TRADING_ENABLED=true`.
