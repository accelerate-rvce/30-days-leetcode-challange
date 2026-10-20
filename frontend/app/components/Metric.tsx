export function Metric({ label, value, detail, accent = false, progress }: { label: string; value: string; detail: string; accent?: boolean; progress?: number }) {
  return <article className="metric-card"><div className="metric-label">{label}<span className={accent ? "accent-dot" : "muted-dot"} /></div><div className="metric-value">{value}</div>{typeof progress === "number" && <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}<div className="metric-detail">{detail}</div></article>;
}
