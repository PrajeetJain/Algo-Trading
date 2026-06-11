# Aindra Trader — VPS Deployment Guide

Goal: run the paper bot unattended on an always-on machine so a laptop sleep,
browser close, or Wi-Fi drop never interrupts the month-long paper test.

The backend owns the bot runtime (it trades, manages stops, squares off, and
recovers after restart from SQLite). The browser is only a viewer/controller,
so the server is the only thing that must stay up.

## What you need

- A small VPS (1 vCPU / 1 GB RAM is plenty): Hetzner, DigitalOcean, Oracle
  Free Tier, or an always-on home machine.
- Node.js 24+ (or Docker).
- Your Kite API key/secret in `.env` (never commit it).

## Option A: PM2 (recommended, simplest)

```bash
# on the VPS
git clone https://github.com/PrajeetJain/Algo-Trading.git
cd Algo-Trading
npm install
npm run build                  # builds the UI into dist/
cp .env.example .env           # then edit .env with your keys
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup        # auto-start on reboot
```

The API server also serves the built UI, so the dashboard is available at
`http://127.0.0.1:8787` on the VPS.

## Option B: Docker

```bash
docker build -t aindra-trader .
docker run -d --name aindra \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v aindra-data:/app/.aindra-data \
  --env-file .env \
  aindra-trader
```

## Exposing the dashboard safely

Never expose port 8787 raw to the internet — the API has no authentication.
Pick one:

1. **SSH tunnel (zero setup)** — from your laptop/phone (Termius etc.):
   `ssh -L 8787:127.0.0.1:8787 user@your-vps` then open
   `http://127.0.0.1:8787`.
2. **Tailscale (best for phone use)** — install on the VPS and your phone;
   open `http://<vps-tailscale-ip>:8787`. Private network, no public exposure.
3. **Caddy reverse proxy with basic auth + HTTPS** if you need a public URL:

   ```text
   trade.example.com {
     basic_auth { you <bcrypt-hash> }
     reverse_proxy 127.0.0.1:8787
   }
   ```

## Daily routine (the one manual step)

Zerodha requires a fresh token every trading day:

1. Open the dashboard (tunnel/Tailscale) in the morning.
2. Click **Open Kite**, log in, paste the `request_token`, click **Connect**.
3. Click **Start Bot** (or arm it pre-open).
4. Telegram tells you everything else (entries, exits, daily lock, EOD net).

## Telegram notifications

1. Message `@BotFather` → `/newbot` → copy the token.
2. Send any message to your new bot.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy
   `chat.id`.
4. Put both in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) and restart.

## Backups

Everything that matters lives in `.aindra-data/` (SQLite DB, JSONL ledger,
risk state). Back it up daily:

```bash
# crontab -e
55 15 * * 1-5 tar czf ~/backups/aindra-$(date +\%F).tar.gz -C ~/Algo-Trading .aindra-data
```

## Health monitoring

- `GET /api/health` — server up.
- `GET /api/paper/state` — `heartbeat.healthy` must be true while running.
- Point a free uptime monitor (UptimeRobot/healthchecks.io via tunnel, or a
  cron + curl that pings Telegram on failure) at `/api/health`.

## Useful PM2 commands

```bash
pm2 logs aindra-api          # tail logs
pm2 restart aindra-api       # restart (positions recover from SQLite)
pm2 monit                    # live CPU/memory
```
