import { CheckCircle2, RefreshCw, Scale, ShieldAlert, XCircle } from "lucide-react";
import type { VerdictPayload } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Panel } from "../components/ui";

export function VerdictView({
  verdict,
  onRefresh,
}: {
  verdict: VerdictPayload | null;
  onRefresh: () => void;
}) {
  const tone = verdict?.verdict === "GO" ? "gain" : verdict?.verdict === "NO-GO" ? "loss" : "warning";
  const metrics = verdict?.metrics;

  return (
    <section className="analytics-page">
      <div className="history-page-header">
        <div>
          <p className="eyebrow">Paper-Month Evidence</p>
          <h2>Go / No-Go Verdict</h2>
        </div>
        <div className="history-page-actions">
          <button className="mini-action" type="button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <Panel title="Verdict" icon={<Scale size={18} />}>
        {verdict ? (
          <div className="verdict-box">
            <span className={`verdict-badge ${tone}`}>
              {verdict.verdict === "GO" ? "GO" : verdict.verdict === "NO-GO" ? "NO-GO" : "NOT YET"}
            </span>
            <p className="verdict-text">{verdict.verdictText}</p>
          </div>
        ) : (
          <div className="journal-empty">Verdict unavailable. Start the API server.</div>
        )}
      </Panel>

      <Panel title="Criteria Checklist" icon={<ShieldAlert size={18} />}>
        <div className="analytics-table verdict-table">
          <div className="analytics-head">
            <span>Criterion</span>
            <span>Required</span>
            <span>Actual</span>
            <span>Status</span>
          </div>
          {verdict?.criteria.map((criterion) => (
            <div className="analytics-row" key={criterion.id}>
              <strong>{criterion.label}</strong>
              <span>{criterion.required}</span>
              <span>{criterion.actual}</span>
              <span className={criterion.pass ? "gain" : "warning"}>
                {criterion.pass ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
                {criterion.pass ? " Pass" : " Fail"}
              </span>
            </div>
          )) ?? <div className="journal-empty">No criteria yet</div>}
        </div>
      </Panel>

      <Panel title="Evidence Metrics" icon={<Scale size={18} />}>
        <div className="analytics-summary">
          <div>
            <span>Net P&L (after charges)</span>
            <strong className={(metrics?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>{formatCurrency(metrics?.netPnl ?? 0, 2)}</strong>
            <small>{metrics?.closedTrades ?? 0} trades over {metrics?.tradingDays ?? 0} days</small>
          </div>
          <div>
            <span>Expectancy / Trade</span>
            <strong className={(metrics?.expectancy ?? 0) >= 0 ? "gain" : "loss"}>
              {formatCurrency(metrics?.expectancy ?? 0, 2)}
            </strong>
            <small>{formatPercent(metrics?.expectancyPctOfCapital ?? 0, 3)} of capital</small>
          </div>
          <div>
            <span>Profit Factor</span>
            <strong>{(metrics?.profitFactor ?? 0).toFixed(2)}</strong>
            <small>{formatPercent(metrics?.winRate ?? 0, 0)} win rate</small>
          </div>
          <div>
            <span>Max Drawdown</span>
            <strong className="loss">{formatCurrency(metrics?.maxDrawdown ?? 0, 2)}</strong>
            <small>{formatPercent(metrics?.maxDrawdownPctOfCapital ?? 0)} of capital</small>
          </div>
          <div>
            <span>Sharpe (annualized)</span>
            <strong>{(metrics?.sharpeAnnualized ?? 0).toFixed(2)}</strong>
            <small>daily {(metrics?.sharpeDaily ?? 0).toFixed(2)}</small>
          </div>
          <div>
            <span>t-Statistic</span>
            <strong className={(metrics?.tStatistic ?? 0) >= 2 ? "gain" : undefined}>
              {(metrics?.tStatistic ?? 0).toFixed(2)}
            </strong>
            <small>edge vs zero</small>
          </div>
          <div>
            <span>Worst Streaks</span>
            <strong>
              {metrics?.maxConsecutiveLosingTrades ?? 0} trades / {metrics?.maxConsecutiveLosingDays ?? 0} days
            </strong>
            <small>consecutive losses</small>
          </div>
          <div>
            <span>Charges Drag</span>
            <strong>{formatPercent(metrics?.chargesPctOfGross ?? 0, 1)}</strong>
            <small>{formatCurrency(metrics?.charges ?? 0, 0)} total</small>
          </div>
        </div>
      </Panel>

      <Panel title="Equity Curve (all paper days)" icon={<Scale size={18} />}>
        {verdict?.equityCurve.length ? (
          <>
            <EquitySvg curve={verdict.equityCurve} />
            <div className="equity-meta">
              <span>{formatDate(verdict.equityCurve[0].date)}</span>
              <strong className={verdict.equityCurve[verdict.equityCurve.length - 1].equity >= 0 ? "gain" : "loss"}>
                {formatCurrency(verdict.equityCurve[verdict.equityCurve.length - 1].equity, 2)}
              </strong>
              <span>{formatDate(verdict.equityCurve[verdict.equityCurve.length - 1].date)}</span>
            </div>
          </>
        ) : (
          <div className="journal-empty">No closed trading days yet</div>
        )}
      </Panel>
    </section>
  );
}

function EquitySvg({ curve }: { curve: Array<{ date: string; equity: number }> }) {
  const width = 640;
  const height = 160;
  if (curve.length < 2) {
    return <div className="journal-empty">Need at least 2 trading days for a curve</div>;
  }
  const values = curve.map((point) => point.equity);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const xFor = (index: number) => (index / (curve.length - 1)) * width;
  const yFor = (value: number) => height - ((value - min) / range) * height;
  const line = curve.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)},${yFor(point.equity).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <div className="equity-chart" aria-label="Cumulative paper equity">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <line x1={0} y1={yFor(0)} x2={width} y2={yFor(0)} className="equity-zero" />
        <path d={line} className={last >= 0 ? "equity-line gain" : "equity-line loss"} fill="none" />
      </svg>
    </div>
  );
}
