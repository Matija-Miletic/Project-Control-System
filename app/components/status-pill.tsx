import type { HealthStatus } from "../../lib/types";

export function StatusPill({
  status,
  children,
}: {
  status: HealthStatus;
  children: React.ReactNode;
}) {
  return (
    <span className="status-pill" data-status={status}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

