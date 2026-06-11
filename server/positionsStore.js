import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Durable runtime state for the paper bot. The JSONL event ledger remains the
// append-only audit log; this database is what lets the bot survive a server
// crash with its open positions and engine state intact.

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
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      entry_at TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      stop_loss REAL,
      target REAL,
      strategy TEXT,
      score REAL,
      last_price REAL,
      mfe REAL DEFAULT 0,
      mae REAL DEFAULT 0,
      exit_price REAL,
      exit_at TEXT,
      exit_reason TEXT,
      gross_pnl REAL,
      charges REAL,
      net_pnl REAL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_date ON positions(trade_date);
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS day_stats (
      trade_date TEXT PRIMARY KEY,
      peak_pnl REAL NOT NULL DEFAULT 0,
      trough_pnl REAL NOT NULL DEFAULT 0,
      last_pnl REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  // Migration: initial_stop records the stop at entry so trailing-stop moves
  // don't erase the original risk (needed for R-multiple analytics).
  try {
    db.exec("ALTER TABLE positions ADD COLUMN initial_stop REAL");
  } catch {
    // column already exists
  }
  return db;
}

function rowToPosition(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    symbol: row.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    entryAt: row.entry_at,
    tradeDate: row.trade_date,
    stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
    initialStop: row.initial_stop === null || row.initial_stop === undefined ? (row.stop_loss === null ? null : Number(row.stop_loss)) : Number(row.initial_stop),
    target: row.target === null ? null : Number(row.target),
    strategy: row.strategy ?? "unknown",
    score: Number(row.score ?? 0),
    lastPrice: Number(row.last_price ?? row.entry_price),
    mfe: Number(row.mfe ?? 0),
    mae: Number(row.mae ?? 0),
    exitPrice: row.exit_price === null ? null : Number(row.exit_price),
    exitAt: row.exit_at,
    exitReason: row.exit_reason,
    grossPnl: row.gross_pnl === null ? null : Number(row.gross_pnl),
    charges: row.charges === null ? null : Number(row.charges),
    netPnl: row.net_pnl === null ? null : Number(row.net_pnl),
    updatedAt: row.updated_at,
  };
}

export function insertPosition(position) {
  getDb()
    .prepare(
      `INSERT INTO positions (
        id, status, symbol, side, quantity, entry_price, entry_at, trade_date,
        stop_loss, initial_stop, target, strategy, score, last_price, mfe, mae, updated_at
      ) VALUES (?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    )
    .run(
      position.id,
      position.symbol,
      position.side,
      position.quantity,
      position.entryPrice,
      position.entryAt,
      position.tradeDate,
      position.stopLoss ?? null,
      position.stopLoss ?? null,
      position.target ?? null,
      position.strategy ?? "unknown",
      position.score ?? 0,
      position.lastPrice ?? position.entryPrice,
      new Date().toISOString()
    );
  return getPosition(position.id);
}

export function getPosition(id) {
  return rowToPosition(getDb().prepare("SELECT * FROM positions WHERE id = ?").get(id));
}

export function openPositions() {
  return getDb()
    .prepare("SELECT * FROM positions WHERE status = 'OPEN' ORDER BY entry_at ASC")
    .all()
    .map(rowToPosition);
}

export function positionsForDate(tradeDate) {
  return getDb()
    .prepare("SELECT * FROM positions WHERE trade_date = ? ORDER BY entry_at ASC")
    .all(tradeDate)
    .map(rowToPosition);
}

export function updatePositionMarks(id, { lastPrice, mfe, mae, stopLoss = null }) {
  if (stopLoss === null) {
    getDb()
      .prepare("UPDATE positions SET last_price = ?, mfe = ?, mae = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'")
      .run(lastPrice, mfe, mae, new Date().toISOString(), id);
    return;
  }
  getDb()
    .prepare(
      "UPDATE positions SET last_price = ?, mfe = ?, mae = ?, stop_loss = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'"
    )
    .run(lastPrice, mfe, mae, stopLoss, new Date().toISOString(), id);
}

export function closePosition(id, { exitPrice, exitAt, exitReason, grossPnl, charges, netPnl }) {
  getDb()
    .prepare(
      `UPDATE positions SET
        status = 'CLOSED', exit_price = ?, exit_at = ?, exit_reason = ?,
        gross_pnl = ?, charges = ?, net_pnl = ?, updated_at = ?
      WHERE id = ? AND status = 'OPEN'`
    )
    .run(exitPrice, exitAt, exitReason, grossPnl, charges, netPnl, new Date().toISOString(), id);
  return getPosition(id);
}

export function closedPositions(limit = 500) {
  return getDb()
    .prepare("SELECT * FROM positions WHERE status = 'CLOSED' ORDER BY exit_at DESC LIMIT ?")
    .all(limit)
    .map(rowToPosition);
}

// Tracks the intraday P&L envelope so analytics can answer "how often did we
// touch +0.25%/+0.5%... before giving it back" without storing every tick.
export function upsertDayStats(tradeDate, dayPnl) {
  getDb()
    .prepare(
      `INSERT INTO day_stats (trade_date, peak_pnl, trough_pnl, last_pnl, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(trade_date) DO UPDATE SET
         peak_pnl = MAX(peak_pnl, excluded.peak_pnl),
         trough_pnl = MIN(trough_pnl, excluded.trough_pnl),
         last_pnl = excluded.last_pnl,
         updated_at = excluded.updated_at`
    )
    .run(tradeDate, Math.max(0, dayPnl), Math.min(0, dayPnl), dayPnl, new Date().toISOString());
}

export function allDayStats() {
  return getDb()
    .prepare("SELECT * FROM day_stats ORDER BY trade_date DESC")
    .all()
    .map((row) => ({
      tradeDate: row.trade_date,
      peakPnl: Number(row.peak_pnl),
      troughPnl: Number(row.trough_pnl),
      lastPnl: Number(row.last_pnl),
      updatedAt: row.updated_at,
    }));
}

export function getBotState(key, fallback = null) {
  const row = getDb().prepare("SELECT value FROM bot_state WHERE key = ?").get(key);
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setBotState(key, value) {
  getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}
