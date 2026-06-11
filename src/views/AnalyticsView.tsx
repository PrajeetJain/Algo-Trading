import { Activity, AlertTriangle, BarChart3, Cpu, Database, Download, FileClock, RefreshCw, TrendingUp } from "lucide-react";
import type { AnalyticsPayload, TradeQualityPayload } from "../types";
import { formatCurrency, formatDateTime, formatPercent, strategyLabel } from "../lib/format";
import { Panel } from "../components/ui";

export function AnalyticsView({
  analytics,
  tradeQuality,
  analyticsError,
  onRefresh,
  onExport,
}: {
  analytics: AnalyticsPayload | null;
  tradeQuality: TradeQualityPayload | null;
  analyticsError: string;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <section className="analytics-page">
      <div className="history-page-header">
        <div>
          <p className="eyebrow">V2 Evidence Layer</p>
          <h2>Analytics</h2>
        </div>
        <div className="history-page-actions">
          <button className="mini-action" type="button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="mini-action" type="button" onClick={onExport} disabled={!analytics}>
            <Download size={16} aria-hidden="true" />
            <span>Analytics CSV</span>
          </button>
        </div>
      </div>

      <Panel title="Evidence Summary" icon={<BarChart3 size={18} />}>
        <div className="analytics-summary">
          <div>
            <span>Signal Snapshots</span>
            <strong>{analytics?.totals.signalSnapshots ?? 0}</strong>
            <small>{analytics?.totals.totalSignals ?? 0} total signals</small>
          </div>
          <div>
            <span>Eligible Rate</span>
            <strong>{formatPercent(analytics?.totals.eligibleRate ?? 0, 1)}</strong>
            <small>{analytics?.totals.eligibleSignals ?? 0} eligible</small>
          </div>
          <div>
            <span>Trade Decisions</span>
            <strong>{analytics?.totals.tradeDecisions ?? 0}</strong>
            <small>{analytics?.totals.waitDecisions ?? 0} waits</small>
          </div>
          <div>
            <span>Closed Trade Net</span>
            <strong className={(analytics?.totals.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
              {formatCurrency(analytics?.totals.netPnl ?? 0, 2)}
            </strong>
            <small>{formatPercent(analytics?.totals.winRate ?? 0, 0)} win rate</small>
          </div>
        </div>
        {analyticsError ? <p className="broker-note warning">{analyticsError}</p> : null}
      </Panel>

      <div className="analytics-grid">
        <Panel title="Trade Performance by Strategy" icon={<Activity size={18} />}>
          <div className="analytics-table trade-performance-table">
            <div className="analytics-head">
              <span>Strategy</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>PF</span>
            </div>
            {analytics?.tradePerformance.byStrategy.length ? (
              analytics.tradePerformance.byStrategy.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{strategyLabel(row.key)}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{row.profitFactor.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed trades with strategy metadata yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Signal Quality by Strategy" icon={<Cpu size={18} />}>
          <div className="analytics-table signal-quality-table">
            <div className="analytics-head">
              <span>Strategy</span>
              <span>Samples</span>
              <span>Eligible</span>
              <span>Score</span>
              <span>RS</span>
              <span>Net R:R</span>
            </div>
            {analytics?.signalQuality.byStrategy.length ? (
              analytics.signalQuality.byStrategy.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{strategyLabel(row.key)}</strong>
                  <span>{row.samples}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.avgScore.toFixed(1)}</span>
                  <span className={row.avgRelativeStrength >= 0 ? "gain" : "loss"}>{formatPercent(row.avgRelativeStrength)}</span>
                  <span>{row.avgNetRewardRisk.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No signal snapshots yet</div>
            )}
          </div>
        </Panel>
      </div>

      <div className="analytics-grid">
        <Panel title="Symbol Performance" icon={<Database size={18} />}>
          <div className="analytics-table symbol-performance-table">
            <div className="analytics-head">
              <span>Symbol</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>Charges</span>
            </div>
            {analytics?.tradePerformance.bySymbol.length ? (
              analytics.tradePerformance.bySymbol.slice(0, 10).map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{formatCurrency(row.charges, 2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed symbol performance yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Market Regime Samples" icon={<TrendingUp size={18} />}>
          <div className="analytics-table regime-table">
            <div className="analytics-head">
              <span>Regime</span>
              <span>Snapshots</span>
              <span>Eligible</span>
              <span>Trades</span>
            </div>
            {analytics?.signalQuality.byRegime.length ? (
              analytics.signalQuality.byRegime.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.snapshots}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.tradeDecisions}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No regime samples yet</div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Trade Quality - MFE / MAE" icon={<Activity size={18} />}>
        <div className="analytics-summary">
          <div>
            <span>Avg Time In Trade</span>
            <strong>{(tradeQuality?.totals.avgTimeInTradeMin ?? 0).toFixed(0)} min</strong>
            <small>{tradeQuality?.totals.closedTrades ?? 0} engine-closed trades</small>
          </div>
          <div>
            <span>Avg MFE / MAE</span>
            <strong>
              {formatCurrency(tradeQuality?.totals.avgMfeAmount ?? 0, 0)} / {formatCurrency(tradeQuality?.totals.avgMaeAmount ?? 0, 0)}
            </strong>
            <small>best vs worst excursion</small>
          </div>
          <div>
            <span>Avg R-Multiple</span>
            <strong className={(tradeQuality?.totals.avgRMultiple ?? 0) >= 0 ? "gain" : "loss"}>
              {(tradeQuality?.totals.avgRMultiple ?? 0).toFixed(2)}R
            </strong>
            <small>{((tradeQuality?.totals.avgCaptureRatio ?? 0) * 100).toFixed(0)}% MFE captured</small>
          </div>
          <div>
            <span>Charges</span>
            <strong>{formatPercent(tradeQuality?.totals.chargesPctOfGross ?? 0, 1)}</strong>
            <small>of gross P&L</small>
          </div>
        </div>
        <div className="analytics-grid">
          <div className="analytics-table exit-reason-table">
            <div className="analytics-head">
              <span>Exit Reason</span>
              <span>Trades</span>
              <span>Net P&L</span>
            </div>
            {tradeQuality?.exitReasons.length ? (
              tradeQuality.exitReasons.map((row) => (
                <div className="analytics-row" key={row.reason}>
                  <strong>{row.reason}</strong>
                  <span>{row.trades}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No engine-closed trades yet</div>
            )}
          </div>
          <div className="analytics-table milestone-frequency-table">
            <div className="analytics-head">
              <span>Milestone</span>
              <span>Hit Days</span>
              <span>Hit Rate</span>
              <span>Held To Close</span>
            </div>
            {tradeQuality?.milestoneFrequency.length ? (
              tradeQuality.milestoneFrequency.map((row) => (
                <div className="analytics-row" key={row.pct}>
                  <strong>
                    {row.pct}% ({formatCurrency(row.amount, 0)})
                  </strong>
                  <span>{row.daysHit}</span>
                  <span>{formatPercent(row.hitRate, 0)}</span>
                  <span>{formatPercent(row.holdRate, 0)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No day stats yet</div>
            )}
          </div>
        </div>
      </Panel>

      <div className="analytics-grid">
        <Panel title="Performance by Hour" icon={<FileClock size={18} />}>
          <div className="analytics-table trade-performance-table">
            <div className="analytics-head">
              <span>Entry Hour</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>PF</span>
            </div>
            {analytics?.tradePerformance.byHour?.length ? (
              analytics.tradePerformance.byHour.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{row.profitFactor.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed trades yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Performance by Entry Regime" icon={<TrendingUp size={18} />}>
          <div className="analytics-table trade-performance-table">
            <div className="analytics-head">
              <span>Regime</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>PF</span>
            </div>
            {analytics?.tradePerformance.byEntryRegime?.length ? (
              analytics.tradePerformance.byEntryRegime.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{row.profitFactor.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed trades yet</div>
            )}
          </div>
        </Panel>
      </div>

      <div className="analytics-grid">
        <Panel title="Signal Quality by Score Bucket" icon={<Cpu size={18} />}>
          <div className="analytics-table signal-quality-table">
            <div className="analytics-head">
              <span>Score</span>
              <span>Samples</span>
              <span>Eligible</span>
              <span>Score</span>
              <span>RS</span>
              <span>Net R:R</span>
            </div>
            {analytics?.signalQuality.byScoreBucket?.length ? (
              analytics.signalQuality.byScoreBucket.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.samples}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.avgScore.toFixed(1)}</span>
                  <span className={row.avgRelativeStrength >= 0 ? "gain" : "loss"}>{formatPercent(row.avgRelativeStrength)}</span>
                  <span>{row.avgNetRewardRisk.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No signal snapshots yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Signal Quality by Spread" icon={<AlertTriangle size={18} />}>
          <div className="analytics-table signal-quality-table">
            <div className="analytics-head">
              <span>Spread</span>
              <span>Samples</span>
              <span>Eligible</span>
              <span>Score</span>
              <span>RS</span>
              <span>Net R:R</span>
            </div>
            {analytics?.signalQuality.bySpreadBucket?.length ? (
              analytics.signalQuality.bySpreadBucket.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.samples}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.avgScore.toFixed(1)}</span>
                  <span className={row.avgRelativeStrength >= 0 ? "gain" : "loss"}>{formatPercent(row.avgRelativeStrength)}</span>
                  <span>{row.avgNetRewardRisk.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No signal snapshots yet</div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Recent Signal Decisions" icon={<FileClock size={18} />}>
        <div className="analytics-table recent-signal-table">
          <div className="analytics-head">
            <span>Time</span>
            <span>Symbol</span>
            <span>Side</span>
            <span>Strategy</span>
            <span>Score</span>
            <span>RS</span>
            <span>Net R:R</span>
            <span>Status</span>
            <span>Reason</span>
          </div>
          {analytics?.signalQuality.recent.length ? (
            analytics.signalQuality.recent.slice(0, 20).map((row) => (
              <div className="analytics-row" key={row.id}>
                <span>{formatDateTime(row.createdAt)}</span>
                <strong>{row.symbol}</strong>
                <span className={row.side === "SELL" ? "loss" : "gain"}>{row.side === "SELL" ? "Short" : "Long"}</span>
                <span>{strategyLabel(row.strategy)}</span>
                <span>{row.score}</span>
                <span className={row.relativeStrengthPct >= 0 ? "gain" : "loss"}>{formatPercent(row.relativeStrengthPct)}</span>
                <span>{row.netRewardRisk.toFixed(2)}</span>
                <span className={row.eligible ? "gain" : "warning"}>{row.eligible ? "ELIGIBLE" : "BLOCKED"}</span>
                <span>{row.gateReasons.length ? row.gateReasons.join(", ") : row.regime}</span>
              </div>
            ))
          ) : (
            <div className="journal-empty">No recent signal decisions yet</div>
          )}
        </div>
      </Panel>
    </section>
  );
}
