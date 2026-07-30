"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ControlState,
  ProgrammeCell,
  ProgrammeRow,
} from "../../lib/types";
import { HelpTip } from "./help-tip";
import { PageExports } from "./page-exports";
import { StatusPill } from "./status-pill";

type Mutate = (
  action: string,
  payload: Record<string, unknown>,
  success: string,
) => Promise<boolean>;

type Week = {
  key: string;
  start: string;
  end: string;
  dates: string[];
  isPast: boolean;
  isCurrent: boolean;
};

type VisibleColumn =
  | { type: "date"; key: string; date: string; weekKey: string }
  | { type: "collapsed"; key: string; week: Week };

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function dayName(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function weekStart(value: string) {
  const date = parseDate(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function weekEnd(value: string) {
  const date = parseDate(weekStart(value));
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function buildWeeks(dates: string[], today: string): Week[] {
  const currentWeek = weekStart(today);
  const grouped = new Map<string, string[]>();
  for (const date of dates) {
    const start = weekStart(date);
    grouped.set(start, [...(grouped.get(start) ?? []), date]);
  }
  return [...grouped.entries()].map(([start, weekDates]) => ({
    key: start,
    start,
    end: weekEnd(start),
    dates: weekDates,
    isPast: start < currentWeek,
    isCurrent: start === currentWeek,
  }));
}

function feasibilityStatus(
  value: ProgrammeRow["feasibility"],
): "good" | "watch" | "risk" | "neutral" {
  if (value === "achievable" || value === "complete") return "good";
  if (value === "needs-crew") return "watch";
  return "risk";
}

function feasibilityLabel(value: ProgrammeRow["feasibility"]) {
  if (value === "complete") return "Allocated";
  if (value === "achievable") return "Works";
  if (value === "needs-crew") return "More crew";
  if (value === "over-allocated") return "Over-allocated";
  return "Cannot meet date";
}

function DayCell({
  row,
  cell,
  today,
  busy,
  view,
  showTargetBars,
  showForecastBars,
  mutate,
}: {
  row: ProgrammeRow;
  cell: ProgrammeCell;
  today: string;
  busy: boolean;
  view: "allocations" | "heatmap" | "manual";
  showTargetBars: boolean;
  showForecastBars: boolean;
  mutate: Mutate;
}) {
  const [value, setValue] = useState(
    cell.manDays === null ? "" : String(cell.manDays),
  );

  const shown =
    view === "manual" &&
    cell.kind !== "manual" &&
    cell.kind !== "actual"
      ? ""
      : value;
  const exceedsMaximum =
    cell.manDays !== null &&
    row.maxPracticalCrew !== null &&
    cell.manDays > row.maxPracticalCrew;
  const exceedsAssigned =
    cell.manDays !== null && cell.manDays > row.assignedCrew;

  const save = async () => {
    const trimmed = value.trim();
    const original = cell.manDays === null ? "" : String(cell.manDays);
    if (trimmed === original) return;
    if (!trimmed) {
      if (cell.kind !== "manual") {
        setValue(original);
        return;
      }
      const removed = await mutate(
        "delete-programme-day",
        { taskId: row.taskId, date: cell.date },
        `Manual value removed for ${row.taskName}.`,
      );
      if (!removed) setValue(original);
      return;
    }
    const manDays = Number(trimmed);
    if (!Number.isFinite(manDays) || manDays < 0 || manDays > 100) {
      setValue(original);
      return;
    }
    const saved = await mutate(
      "upsert-programme-day",
      { taskId: row.taskId, date: cell.date, manDays },
      `${manDays} man-days saved for ${row.taskName}. Future values recalculated.`,
    );
    if (!saved) setValue(original);
  };

  return (
    <div
      className={[
        "programme-cell",
        `cell-${cell.kind}`,
        cell.date === today ? "today-column" : "",
        cell.date === row.targetFinish ? "due-column" : "",
        showTargetBars &&
        cell.date >= row.targetStart &&
        cell.date <= row.targetFinish
          ? "target-window"
          : "",
        showForecastBars &&
        cell.date >= row.forecastStart &&
        cell.date <= row.forecastFinish
          ? "forecast-window"
          : "",
        exceedsMaximum ? "over-maximum" : "",
        !exceedsMaximum && exceedsAssigned ? "over-assigned" : "",
        view === "heatmap" ? "heatmap-cell" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-date={cell.date}
      title={`${row.taskName} · ${shortDate(cell.date)} · ${
        cell.kind === "projected"
          ? "automatic requirement"
          : cell.kind
      }${cell.note ? ` · ${cell.note}` : ""}`}
      style={
        view === "heatmap" && cell.manDays
          ? ({
              "--cell-intensity": Math.min(
                1,
                cell.manDays / Math.max(1, row.maxPracticalCrew ?? 8),
              ),
            } as CSSProperties)
          : undefined
      }
    >
      <input
        aria-label={`${row.taskName}, ${shortDate(cell.date)}, man-days`}
        type="number"
        min="0"
        max="100"
        step="0.1"
        inputMode="decimal"
        disabled={
          busy ||
          (view === "manual" &&
            cell.kind !== "manual" &&
            cell.kind !== "actual")
        }
        value={shown}
        placeholder={cell.kind === "projected" ? String(cell.manDays ?? "") : ""}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setValue(cell.manDays === null ? "" : String(cell.manDays));
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function ProgrammeBoard({
  state,
  busy,
  mutate,
}: {
  state: ControlState;
  busy: boolean;
  mutate: Mutate;
}) {
  const weeks = useMemo(
    () => buildWeeks(state.programme.dates, state.programme.today),
    [state.programme.dates, state.programme.today],
  );
  const defaultCollapsed = useMemo(
    () => new Set(weeks.filter((week) => week.isPast).map((week) => week.key)),
    [weeks],
  );
  const [collapsedWeeks, setCollapsedWeeks] =
    useState<Set<string>>(defaultCollapsed);
  const [view, setView] = useState<
    "allocations" | "heatmap" | "manual"
  >("allocations");
  const [workPackage, setWorkPackage] = useState("all");
  const [showCompleted, setShowCompleted] = useState(true);
  const [showDemand, setShowDemand] = useState(true);
  const [showTargetBars, setShowTargetBars] = useState(true);
  const [showForecastBars, setShowForecastBars] = useState(true);
  const boardRef = useRef<HTMLDivElement>(null);

  const visibleColumns = weeks.reduce<VisibleColumn[]>((columns, week) => {
    if (week.isPast && collapsedWeeks.has(week.key)) {
      columns.push({ type: "collapsed", key: week.key, week });
    } else {
      columns.push(
        ...week.dates.map((date) => ({
          type: "date" as const,
          key: date,
          date,
          weekKey: week.key,
        })),
      );
    }
    return columns;
  }, []);
  const rows = state.programme.rows.filter(
    (row) =>
      (workPackage === "all" || row.workPackage === workPackage) &&
      (showCompleted || row.status !== "complete"),
  );
  const packages = [...new Set(state.tasks.map((task) => task.workPackage))];
  const highestDemand = Math.max(
    1,
    ...state.programme.dailyDemand.map((item) => item.manDays),
  );
  const chartDates = state.programme.dailyDemand.filter(
    (item) => item.date >= state.programme.today,
  );

  const reset = async () => {
    if (
      !window.confirm(
        "Reset every manual value after today? Historical entries, today, approved changes and baseline dates will be kept.",
      )
    ) {
      return;
    }
    await mutate(
      "reset-forecasts",
      {},
      "Future manual values cleared. Default man-days per working day have been restored.",
    );
  };

  const toggleWeek = (weekKey: string) => {
    setCollapsedWeeks((current) => {
      const next = new Set(current);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  };

  const goToToday = () => {
    boardRef.current
      ?.querySelector(`[data-date="${state.programme.today}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      boardRef.current
        ?.querySelector(`[data-date="${state.programme.today}"]`)
        ?.scrollIntoView({
          behavior: "auto",
          inline: "center",
          block: "nearest",
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.programme.today]);

  return (
    <>
      <section className="panel programme-panel">
        <div className="card-heading programme-heading">
          <div>
            <span className="eyebrow">Interactive day-level programme</span>
            <h2>
              Man-day allocation grid
              <HelpTip
                topic="programme-grid"
                summary="Enter man-days directly; future working days recalculate to meet each task due date."
              />
            </h2>
            <p className="section-copy">
              One man-day equals one person working{" "}
              {state.project.productiveHoursPerPerson} hours. Enter 2 for two
              full person-days, or 0.5 for half a person-day. Yellow values stay
              fixed; automatic weekday values after the latest entry immediately
              recalculate to finish by the task due date.
            </p>
          </div>
          <div className="programme-primary-actions">
            <PageExports scope="programme" />
            <button
              className="button danger-outline"
              type="button"
              disabled={busy}
              onClick={() => void reset()}
            >
              Reset future values
            </button>
          </div>
        </div>

        <div className="programme-kpis">
          <div>
            <span>Tasks shown</span>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <span>Need more crew</span>
            <strong>
              {
                rows.filter((row) => row.feasibility === "needs-crew").length
              }
            </strong>
          </div>
          <div>
            <span>Cannot meet due date</span>
            <strong>
              {
                rows.filter((row) =>
                  ["not-achievable", "over-allocated"].includes(
                    row.feasibility,
                  ),
                ).length
              }
            </strong>
          </div>
          <div>
            <span>Peak demand</span>
            <strong>{highestDemand.toFixed(1)} man-days</strong>
          </div>
        </div>

        <div className="programme-toolbar">
          <div className="segmented-control" aria-label="Programme view">
            {[
              ["allocations", "Allocations"],
              ["heatmap", "Crew heatmap"],
              ["manual", "Manual only"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() =>
                  setView(value as "allocations" | "heatmap" | "manual")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="toolbar-field">
            <span>Work package</span>
            <select
              value={workPackage}
              onChange={(event) => setWorkPackage(event.target.value)}
            >
              <option value="all">All work packages</option>
              {packages.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            Show completed
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showDemand}
              onChange={(event) => setShowDemand(event.target.checked)}
            />
            Demand graph
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showTargetBars}
              onChange={(event) => setShowTargetBars(event.target.checked)}
            />
            Target bars
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showForecastBars}
              onChange={(event) => setShowForecastBars(event.target.checked)}
            />
            Forecast bars
          </label>
          <div className="toolbar-buttons">
            <button className="button quiet" type="button" onClick={goToToday}>
              Today
            </button>
            <button
              className="button quiet"
              type="button"
              onClick={() => setCollapsedWeeks(new Set())}
            >
              Expand past
            </button>
            <button
              className="button quiet"
              type="button"
              onClick={() => setCollapsedWeeks(defaultCollapsed)}
            >
              Collapse past
            </button>
          </div>
        </div>

        <div className="programme-legend" aria-label="Programme legend">
          <span><i className="legend-actual" />Daily record</span>
          <span><i className="legend-manual" />Manual man-days</span>
          <span><i className="legend-projected" />Automatic requirement</span>
          <span><i className="legend-weekend" />Weekend / exception</span>
          <span><i className="legend-risk" />Crew limit exceeded</span>
          {showTargetBars ? <span><i className="legend-target" />Target window</span> : null}
          {showForecastBars ? <span><i className="legend-forecast" />Forecast window</span> : null}
          <span><i className="legend-today" />Today</span>
        </div>

        {showDemand ? (
          <section className="demand-chart" aria-label="Total man-day demand">
            <header>
              <strong>Daily labour demand</strong>
              <small>Total fixed and projected man-days</small>
            </header>
            <div>
              {chartDates.map((item) => (
                <span
                  key={item.date}
                  className={item.date === state.programme.today ? "today" : ""}
                  style={{ height: `${Math.max(2, (item.manDays / highestDemand) * 100)}%` }}
                  title={`${shortDate(item.date)}: ${item.manDays} man-days`}
                />
              ))}
            </div>
          </section>
        ) : null}

        <div className="programme-scroll" ref={boardRef}>
          <div
            className="programme-grid"
            style={{
              gridTemplateColumns: `minmax(330px, 330px) ${visibleColumns
                .map((column) =>
                  column.type === "collapsed" ? "76px" : "58px",
                )
                .join(" ")}`,
            }}
          >
            <div className="programme-corner week-row">Task / requirement</div>
            {weeks.flatMap((week) => {
              const visible = visibleColumns.filter(
                (column) =>
                  (column.type === "collapsed" && column.week.key === week.key) ||
                  (column.type === "date" && column.weekKey === week.key),
              );
              if (visible.length === 0) return [];
              return (
                <div
                  key={`week-${week.key}`}
                  className={[
                    "week-heading",
                    week.isCurrent ? "current-week" : "",
                    week.isPast ? "past-week" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ gridColumn: `span ${visible.length}` }}
                >
                  <button
                    type="button"
                    disabled={!week.isPast}
                    onClick={() => week.isPast && toggleWeek(week.key)}
                    title={
                      week.isPast
                        ? collapsedWeeks.has(week.key)
                          ? "Expand this week"
                          : "Collapse this week"
                        : undefined
                    }
                  >
                    {shortDate(week.start)} – {shortDate(week.end)}
                    {week.isPast ? (
                      <b>{collapsedWeeks.has(week.key) ? "＋" : "−"}</b>
                    ) : null}
                  </button>
                </div>
              );
            })}

            <div className="programme-corner date-row">Due / required crew</div>
            {visibleColumns.map((column) =>
              column.type === "collapsed" ? (
                <button
                  type="button"
                  className="collapsed-date-heading"
                  key={`date-${column.key}`}
                  onClick={() => toggleWeek(column.week.key)}
                >
                  Past week
                  <small>expand</small>
                </button>
              ) : (
                <div
                  className={[
                    "date-heading",
                    column.date === state.programme.today ? "today-column" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-date={column.date}
                  key={`date-${column.key}`}
                >
                  <span>{dayName(column.date)}</span>
                  <strong>{parseDate(column.date).getUTCDate()}</strong>
                </div>
              ),
            )}

            {rows.flatMap((row) => {
              const rowItems = [
                <div className="programme-task" key={`${row.taskId}-task`}>
                  <div>
                    <strong>{row.taskName}</strong>
                    <small>
                      {row.workPackage} · due {shortDate(row.targetFinish)}
                    </small>
                  </div>
                  <div className="task-requirement">
                    <span>
                      <b>
                        {row.allocationVarianceManDays > 0
                          ? `+${row.allocationVarianceManDays.toFixed(1)}`
                          : Number.isFinite(row.requiredManDaysPerWorkingDay)
                          ? row.requiredManDaysPerWorkingDay.toFixed(1)
                          : "∞"}
                      </b>
                      {row.allocationVarianceManDays > 0
                        ? "excess"
                        : "/day"}
                    </span>
                    <StatusPill status={feasibilityStatus(row.feasibility)}>
                      {feasibilityLabel(row.feasibility)}
                    </StatusPill>
                  </div>
                </div>,
              ];
              for (const column of visibleColumns) {
                if (column.type === "collapsed") {
                  const total = row.cells
                    .filter((cell) => column.week.dates.includes(cell.date))
                    .reduce((sum, cell) => sum + (cell.manDays ?? 0), 0);
                  rowItems.push(
                    <button
                      className="collapsed-week-cell"
                      type="button"
                      key={`${row.taskId}-${column.key}`}
                      onClick={() => toggleWeek(column.week.key)}
                      title={`Expand week. ${total.toFixed(1)} man-days total.`}
                    >
                      {total > 0 ? total.toFixed(1) : "—"}
                    </button>,
                  );
                } else {
                  const cell = row.cells.find(
                    (item) => item.date === column.date,
                  );
                  if (!cell) continue;
                  rowItems.push(
                    <DayCell
                      key={`${row.taskId}-${column.date}-${cell.kind}-${cell.manDays ?? "empty"}`}
                      row={row}
                      cell={cell}
                      today={state.programme.today}
                      busy={busy}
                      view={view}
                      showTargetBars={showTargetBars}
                      showForecastBars={showForecastBars}
                      mutate={mutate}
                    />,
                  );
                }
              }
              return rowItems;
            })}
          </div>
        </div>
      </section>
    </>
  );
}
