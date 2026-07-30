import { compareDates, workingDaysInclusive } from "./date";
import { round } from "./engine";
import type { ControlState } from "./types";

function monthEnd(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10);
}

function nextMonth(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}

export function buildLabourTrend(state: ControlState) {
  const cutoffs: string[] = [];
  let cursor = monthEnd(state.project.originalStart);
  while (compareDates(cursor, state.project.statusDate) < 0) {
    cutoffs.push(cursor);
    cursor = monthEnd(nextMonth(cursor));
  }
  cutoffs.push(state.project.statusDate);
  const visibleCutoffs = cutoffs.slice(-5);
  const holidays = new Set(state.holidayDates);

  return visibleCutoffs.map((cutoff, index) => {
    const planned = state.tasks.reduce((total, task) => {
      const revisedHours =
        task.originalBudgetHours + task.approvedVariationHours;
      if (compareDates(cutoff, task.targetStart) < 0) return total;
      if (compareDates(cutoff, task.targetFinish) >= 0) {
        return total + revisedHours;
      }
      const totalDays = workingDaysInclusive(
        task.targetStart,
        task.targetFinish,
        holidays,
      );
      const elapsedDays = workingDaysInclusive(
        task.targetStart,
        cutoff,
        holidays,
      );
      return total + revisedHours * (totalDays > 0 ? elapsedDays / totalDays : 0);
    }, 0);

    const entries = state.entries.filter(
      (entry) =>
        compareDates(entry.date, cutoff) <= 0 &&
        (entry.variationStatus === "none" ||
          entry.variationStatus === "approved"),
    );
    const actual = entries.reduce(
      (total, entry) => total + entry.labourHours,
      0,
    );
    const earned = state.tasks.reduce((total, task) => {
      const completed = entries
        .filter((entry) => entry.taskId === task.id)
        .reduce((units, entry) => units + entry.unitsCompleted, 0);
      const revisedUnits = task.originalUnits + task.approvedVariationUnits;
      const revisedHours =
        task.originalBudgetHours + task.approvedVariationHours;
      return (
        total +
        (revisedUnits > 0
          ? Math.min(completed, revisedUnits) * (revisedHours / revisedUnits)
          : 0)
      );
    }, 0);

    return {
      label:
        index === visibleCutoffs.length - 1
          ? "Status"
          : new Intl.DateTimeFormat("en-NZ", {
              month: "short",
              timeZone: "UTC",
            }).format(new Date(`${cutoff}T00:00:00Z`)),
      planned: round(planned, 1),
      earned: round(earned, 1),
      actual: round(actual, 1),
    };
  });
}
