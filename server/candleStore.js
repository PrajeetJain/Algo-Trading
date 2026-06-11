import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Local store of historical candles so backtests replay identical data every
// run instead of re-downloading (and instead of ever using simulated bars).

let db = null;

function getDb() {
  if (db) {
    return db;
  }
  const dataDir = join(process.cwd(), ".aindra-data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  db = new DatabaseSync(join(dataDir, "aindra.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      time TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY (symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_candles_day ON candles(symbol, interval, substr(time, 1, 10));
  `);
  return db;
}

// Kite returns IST timestamps with a "+0530" suffix; normalize so string
// ordering and Date parsing are both reliable.
export function normalizeCandleTime(time) {
  return typeof time === "string" ? time.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : time;
}

export function upsertCandles(symbol, interval, candles) {
  const statement = getDb().prepare(
    `INSERT INTO candles (symbol, interval, time, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval, time) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, volume = excluded.volume`
  );
  let count = 0;
  for (const candle of candles) {
    statement.run(
      symbol,
      interval,
      normalizeCandleTime(candle.time),
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume ?? 0
    );
    count += 1;
  }
  return count;
}

export function candlesForDays(symbol, interval, days) {
  if (!days.length) {
    return [];
  }
  const placeholders = days.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND interval = ? AND substr(time, 1, 10) IN (${placeholders})
       ORDER BY time ASC`
    )
    .all(symbol, interval, ...days);
}

export function storedDays(interval = "5minute") {
  return getDb()
    .prepare(
      `SELECT DISTINCT substr(time, 1, 10) AS day FROM candles
       WHERE interval = ? ORDER BY day ASC`
    )
    .all(interval)
    .map((row) => row.day);
}

export function candleCoverage(interval = "5minute") {
  const rows = getDb()
    .prepare(
      `SELECT symbol, COUNT(*) AS count, MIN(substr(time,1,10)) AS fromDay, MAX(substr(time,1,10)) AS toDay
       FROM candles WHERE interval = ? GROUP BY symbol ORDER BY symbol`
    )
    .all(interval);
  return {
    interval,
    symbols: rows.map((row) => ({
      symbol: row.symbol,
      candles: Number(row.count),
      fromDay: row.fromDay,
      toDay: row.toDay,
    })),
    days: storedDays(interval),
  };
}
