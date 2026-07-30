import { AppShell } from "./components/app-shell";
import { MetricCard } from "./components/metric-card";
import { StatusPill } from "./components/status-pill";
import { TrendChart } from "./components/trend-chart";
import { aggregateMetrics } from "../lib/engine";
import { loadControlState } from "../lib/control-state";
import { shortNzDate } from "../lib/date";
import Link from "next/link";
import { buildLabourTrend } from "../lib/trend";

function hours(value: number) {
  return `${value.toLocaleString("en-NZ", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} h`;
}

export default async function Home() {
  const state = await loadControlState();
  const summary = aggregateMetrics(state.metrics);
  const riskTasks = state.metrics
    .filter((item) => item.health === "risk")
    .sort((a, b) => a.forecastVariance - b.forecastVariance);
  const pendingVariations = state.variations.filter(
    (item) =>
      !["approved", "rejected", "closed", "paid"].includes(item.status),
  );
  const forecastStatus =
    summary.forecastVariance >= 0 ? "under forecast" : "over forecast";

  const chartPoints = buildLabourTrend(state);

  return (
    <AppShell
      active="/"
      projectName={state.project.name}
      statusDate={shortNzDate(state.project.statusDate)}
      action={
        <Link href="/daily" className="button primary">
          Add today&apos;s progress
        </Link>
      }
    >
      <section className="page-heading">
        <div>
          <span className="eyebrow">Project position</span>
          <h1>What needs attention today</h1>
          <p>
            The summary separates labour efficiency, physical progress and
            programme exposure. Figures are calculated to the status date.
          </p>
        </div>
        <div className="source-warning">
          <StatusPill status="watch">Demo date variance</StatusPill>
          <span>
            The fictional summary finishes 16 Nov; the 6 Nov handover milestone
            controls this demonstration.
          </span>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Project metrics">
        <MetricCard
          label="Revised labour budget"
          value={hours(summary.revisedBudgetHours)}
          detail={`${hours(
            state.tasks.reduce(
              (total, task) => total + task.approvedVariationHours,
              0,
            ),
          )} approved change above the source baseline`}
          status="neutral"
          statusText="Baseline protected"
        />
        <MetricCard
          label="Used / earned to date"
          value={`${hours(summary.actualHours)} / ${hours(summary.earnedHours)}`}
          detail={`${hours(Math.abs(summary.productivityVariance))} ${
            summary.productivityVariance >= 0 ? "under" : "over"
          } labour budget`}
          status={summary.productivityVariance >= 0 ? "good" : "risk"}
          statusText={
            summary.productivityVariance >= 0 ? "Favourable" : "Over budget"
          }
        />
        <MetricCard
          label="Forecast at completion"
          value={hours(summary.forecastTotalHours)}
          detail={`${hours(Math.abs(summary.forecastVariance))} ${forecastStatus}`}
          status={summary.forecastVariance >= 0 ? "good" : "risk"}
          statusText={
            summary.forecastVariance >= 0 ? "Within allowance" : "Recovery needed"
          }
        />
        <MetricCard
          label="Open exposure"
          value={hours(
            pendingVariations.reduce(
              (total, item) => total + item.exposureHours,
              0,
            ),
          )}
          detail={`${pendingVariations.length} variation awaiting resolution`}
          status={pendingVariations.length > 0 ? "watch" : "good"}
          statusText={
            pendingVariations.length > 0 ? "Outside approved budget" : "Clear"
          }
        />
      </section>

      <section className="dashboard-grid">
        <TrendChart points={chartPoints} />

        <article className="attention-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Action queue</span>
              <h2>Highest priority</h2>
            </div>
            <span className="count-badge">
              {state.checks.length}
            </span>
          </div>
          <div className="attention-list">
            {riskTasks.slice(0, 3).map((item) => (
              <Link href="/programme" key={item.task.id} className="attention-row">
                <span className="risk-marker" aria-hidden="true" />
                <span>
                  <strong>{item.task.name}</strong>
                  <small>{item.flags[0] ?? "Forecast review required"}</small>
                </span>
                <b>{hours(Math.abs(item.forecastVariance))}</b>
              </Link>
            ))}
            {state.checks
              .filter((check) => check.area !== "programme")
              .slice(0, 2)
              .map((check) => (
              <a href={check.href} key={check.id} className="attention-row">
                <span
                  className={
                    check.severity === "critical"
                      ? "risk-marker"
                      : "watch-marker"
                  }
                  aria-hidden="true"
                />
                <span>
                  <strong>{check.title}</strong>
                  <small>{check.detail}</small>
                </span>
                <b>{check.area}</b>
              </a>
            ))}
          </div>
          <Link href="/quality" className="text-link">
            Review every exception
          </Link>
        </article>
      </section>

      <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Work package position</span>
            <h2>Tasks with the greatest forecast exposure</h2>
          </div>
          <Link href="/programme" className="text-link">
            Open programme
          </Link>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Progress</th>
                <th>Actual</th>
                <th>Earned</th>
                <th>Forecast variance</th>
                <th>Required staff</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.metrics
                .filter((item) => item.task.originalBudgetHours > 0)
                .sort((a, b) => a.forecastVariance - b.forecastVariance)
                .slice(0, 7)
                .map((item) => (
                  <tr key={item.task.id}>
                    <td>
                      <strong>{item.task.name}</strong>
                      <small>{item.task.workfront}</small>
                    </td>
                    <td>
                      <div className="progress-cell">
                        <span
                          className="progress-bar"
                          aria-label={`${Math.round(
                            item.progressPercent * 100,
                          )}% complete`}
                        >
                          <span
                            style={{
                              width: `${Math.min(
                                100,
                                item.progressPercent * 100,
                              )}%`,
                            }}
                          />
                        </span>
                        {Math.round(item.progressPercent * 100)}%
                      </div>
                    </td>
                    <td>{hours(item.actualHours)}</td>
                    <td>{hours(item.earnedHours)}</td>
                    <td
                      className={
                        item.forecastVariance < 0
                          ? "number-negative"
                          : "number-positive"
                      }
                    >
                      {item.forecastVariance < 0 ? "Over " : "Under "}
                      {hours(Math.abs(item.forecastVariance))}
                    </td>
                    <td>
                      {item.requiredStaffFte !== null
                        ? `${item.requiredStaffFte.toFixed(1)} FTE`
                        : "Overdue"}
                    </td>
                    <td>
                      <StatusPill status={item.health}>
                        {item.health === "risk"
                          ? "Action"
                          : item.health === "watch"
                            ? "Review"
                            : "On track"}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
