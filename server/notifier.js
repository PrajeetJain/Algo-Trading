import { appendEvent } from "./database.js";

// Telegram notifications: free, instant on the phone, no app to build.
// Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env (create a bot
// with @BotFather, message it once, read chat id from getUpdates).
// All sends are fire-and-forget: a notification failure must never affect
// trading logic.

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID ?? "";
  return token && chatId ? { token, chatId } : null;
}

export function notifierStatus() {
  return {
    telegramConfigured: Boolean(telegramConfig()),
  };
}

async function sendTelegram(text) {
  const config = telegramConfig();
  if (!config) {
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML" }),
    });
    if (!response.ok) {
      appendEvent("notify.error", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    appendEvent("notify.error", { message: error instanceof Error ? error.message : "telegram error" });
    return false;
  }
}

function rupees(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(value).toFixed(2)}`;
}

const formatters = {
  "bot.start": () => "▶️ Bot started. Scanning for paper entries.",
  "bot.entry": (p) => `📈 ENTRY ${p.side} ${p.symbol} x ${p.quantity} @ ${rupees(p.price)} (stop ${rupees(p.stopLoss ?? 0)}, target ${rupees(p.target ?? 0)})`,
  "bot.exit": (p) => `${p.netPnl >= 0 ? "✅" : "🔻"} EXIT ${p.symbol} [${p.reason}] net ${rupees(p.netPnl)}`,
  "bot.day-locked": (p) =>
    `${p.status === "target-hit" ? "🎯 Daily target hit" : p.status === "loss-hit" ? "🛑 Daily loss limit hit" : "🌙 Day closed"}: net ${rupees(p.dayPnl)} over ${p.tradesTaken} trade(s). Bot stopped for today.`,
  "bot.kill-switch": () => "🚨 Kill switch activated. All positions squared off.",
  "bot.stale-recovery": (p) => `⚠️ Recovered stale position ${p.symbol} from ${p.tradeDate} (closed at last known price).`,
  "bot.data-stalled": () => "⚠️ Live market data unavailable — stops are not being evaluated.",
  "token.expired": () => "🔑 Kite token missing/expired. Daily Zerodha login needed before the bot can trade.",
};

/**
 * Send a notification. Never throws; never blocks the caller.
 */
export function notify(type, payload = {}) {
  const formatter = formatters[type];
  const text = formatter ? formatter(payload) : `${type}: ${JSON.stringify(payload)}`;
  appendEvent("notify.sent", { type, text });
  void sendTelegram(`<b>Aindra Paper Bot</b>\n${text}`);
}
