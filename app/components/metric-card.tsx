import type { HealthStatus } from "../../lib/types";
import { StatusPill } from "./status-pill";

export function MetricCard({
  label,
  value,
  detail,
  status,
  statusText,
}: {
  label: string;
  value: string;
  detail: string;
  status?: HealthStatus;
  statusText?: string;
}) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <div className="metric-detail">
        <span>{detail}</span>
        {status && statusText ? (
          <StatusPill status={status}>{statusText}</StatusPill>
        ) : null}
      </div>
    </article>
  );
}

