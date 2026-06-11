export function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

export function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <span>{icon}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function BrokerLine({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "active" | "warning" | "neutral";
}) {
  return (
    <div className="broker-line">
      <span>{label}</span>
      <strong className={state}>{value}</strong>
    </div>
  );
}
