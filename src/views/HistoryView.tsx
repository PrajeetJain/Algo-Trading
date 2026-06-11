import { Database, Download, RefreshCw } from "lucide-react";
import type { TradeHistoryPayload } from "../types";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "../lib/format";
import { Panel } from "../components/ui";

export function HistoryView({
  tradeHistory,
  historyError,
  onRefresh,
  onExport,
}: {
  tradeHistory: TradeHistoryPayload | null;
  historyError: string;
  onRefresh: () => void;
  onExport: () => void;
}) {
  const historyTotals = tradeHistory?.totals;
  const latestHistoryDay = tradeHistory?.daily[0];

  return (
    <section className="history-page">
      <div className="history-page-header">
        <div>
          <p className="eyebrow">All Days Ledger</p>
          <h2>Trade History</h2>
        </div>
        <div className="history-page-actions">
          <button className="mini-action" type="button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="mini-action" type="button" onClick={onExport} disabled={!tradeHistory?.trades.length}>
            <Download size={16} aria-hidden="true" />
            <span>History CSV</span>
          </button>
        </div>
      </div>

      <Panel title="Net Profit / Loss" icon={<Database size={18} />}>
        <div className="history-view">
          <div className="history-summary">
            <div>
              <span>All Days Net</span>
              <strong className={(historyTotals?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {formatCurrency(historyTotals?.netPnl ?? 0, 2)}
              </strong>
              <small>{formatPercent(historyTotals?.netPct ?? 0)} of capital</small>
            </div>
            <div>
              <span>Today Net</span>
              <strong className={(latestHistoryDay?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {latestHistoryDay ? formatCurrency(latestHistoryDay.netPnl, 2) : formatCurrency(0, 2)}
              </strong>
              <small>{latestHistoryDay ? formatPercent(latestHistoryDay.netPct) : "0.00%"} of capital</small>
            </div>
            <div>
              <span>Closed Trades</span>
              <strong>{historyTotals?.closedTrades ?? 0}</strong>
              <small>{formatPercent(historyTotals?.winRate ?? 0, 0)} win rate</small>
            </div>
            <div>
              <span>Open / Unmatched</span>
              <strong className={(historyTotals?.openTrades ?? 0) > 0 ? "warning" : undefined}>
                {historyTotals?.openTrades ?? 0}
              </strong>
              <small>{historyTotals?.rejectedOrders ?? 0} rejected</small>
            </div>
          </div>

          {historyError ? <p className="broker-note warning">{historyError}</p> : null}
          {(historyTotals?.openTrades ?? 0) > 0 ? (
            <p className="broker-note warning">
              {historyTotals?.openTrades} entry {historyTotals?.openTrades === 1 ? "order has" : "orders have"} no
              recorded exit. Closed net excludes unmatched rows.
            </p>
          ) : null}

          {tradeHistory?.daily.length ? (
            <div className="daily-history-strip">
              {tradeHistory.daily.slice(0, 6).map((day) => (
                <div key={day.date}>
                  <span>{formatDate(day.date)}</span>
                  <strong className={day.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(day.netPnl, 2)}</strong>
                  <small>
                    {formatPercent(day.netPct)} | {day.trades} trade{day.trades === 1 ? "" : "s"}
                  </small>
                </div>
              ))}
            </div>
          ) : null}

          <div className="history-table">
            <div className="history-head">
              <span>Date</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Qty</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>Charges</span>
              <span>Net P&L</span>
              <span>Return</span>
              <span>Status</span>
            </div>
            {tradeHistory?.trades.length ? (
              tradeHistory.trades.map((trade) => (
                <div className="history-row" key={trade.id}>
                  <span>{formatDate(trade.date)}</span>
                  <span>{formatDateTime(trade.entryAt)}</span>
                  <span>{formatDateTime(trade.exitAt)}</span>
                  <strong>{trade.symbol}</strong>
                  <span className={trade.side === "LONG" ? "gain" : "loss"}>{trade.side}</span>
                  <span>{trade.quantity}</span>
                  <span>{formatCurrency(trade.entryPrice, 2)}</span>
                  <span>{trade.exitPrice ? formatCurrency(trade.exitPrice, 2) : "-"}</span>
                  <span>{formatCurrency(trade.charges, 2)}</span>
                  <span className={trade.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(trade.netPnl, 2)}</span>
                  <span className={trade.netPct >= 0 ? "gain" : "loss"}>{formatPercent(trade.netPct)}</span>
                  <span className={trade.status === "OPEN" ? "warning" : undefined}>{trade.status}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No backend trade history yet</div>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}
