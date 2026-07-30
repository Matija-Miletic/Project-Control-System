import {
  addCalendarDays,
  compareDates,
  dateRangeInclusive,
  isWorkingDay,
  maxDate,
} from "./date";
import { round } from "./engine";
import type {
  DailyEntry,
  ProgrammeDayValue,
  ProgrammeRow,
  ProgrammeState,
  Project,
  Task,
  TaskMetric,
} from "./types";

function key(taskId: string, date: string) {
  return `${taskId}|${date}`;
}

function minDate(values: string[]): string {
  if (values.length === 0) throw new Error("At least one date is required.");
  return values.reduce((earliest, value) =>
    compareDates(value, earliest) < 0 ? value : earliest,
  );
}

function approvedDailyManDays(
  entries: DailyEntry[],
  hoursPerManDay: number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (
      entry.variationStatus !== "none" &&
      entry.variationStatus !== "approved"
    ) {
      continue;
    }
    const entryKey = key(entry.taskId, entry.date);
    totals.set(
      entryKey,
      (totals.get(entryKey) ?? 0) + entry.labourHours / hoursPerManDay,
    );
  }
  return totals;
}

export function applyProgrammeActualOverrides({
  entries,
  values,
  project,
}: {
  entries: DailyEntry[];
  values: ProgrammeDayValue[];
  project: Project;
}): DailyEntry[] {
  const applicable = new Map(
    values
      .filter((value) => compareDates(value.date, project.statusDate) <= 0)
      .map((value) => [key(value.taskId, value.date), value]),
  );
  if (applicable.size === 0) return entries;

  const retained: DailyEntry[] = [];
  const progress = new Map<
    string,
    { units: number; reworkHours: number; delayReason: string | null }
  >();
  for (const entry of entries) {
    const entryKey = key(entry.taskId, entry.date);
    const override = applicable.get(entryKey);
    const isApprovedBase =
      entry.variationStatus === "none" ||
      entry.variationStatus === "approved";
    if (!override || !isApprovedBase) {
      retained.push(entry);
      continue;
    }
    const current = progress.get(entryKey) ?? {
      units: 0,
      reworkHours: 0,
      delayReason: null,
    };
    current.units += entry.unitsCompleted;
    current.reworkHours += entry.reworkHours;
    current.delayReason ??= entry.delayReason;
    progress.set(entryKey, current);
  }

  for (const [entryKey, override] of applicable) {
    const captured = progress.get(entryKey);
    retained.push({
      id: `PROGRAMME-${override.taskId}-${override.date}`,
      taskId: override.taskId,
      date: override.date,
      labourHours: round(
        override.manDays * project.productiveHoursPerPerson,
        4,
      ),
      unitsCompleted: captured?.units ?? 0,
      reworkHours: Math.min(
        captured?.reworkHours ?? 0,
        override.manDays * project.productiveHoursPerPerson,
      ),
      variationStatus: "none",
      variationId: null,
      delayReason: captured?.delayReason ?? null,
      workfront: "Programme grid",
      notes: override.note,
    });
  }
  return retained;
}

export function buildProgrammeState({
  project,
  tasks,
  metrics,
  entries,
  values,
  holidayDates,
  today,
}: {
  project: Project;
  tasks: Task[];
  metrics: TaskMetric[];
  entries: DailyEntry[];
  values: ProgrammeDayValue[];
  holidayDates: ReadonlySet<string>;
  today: string;
}): ProgrammeState {
  const metricByTask = new Map(metrics.map((metric) => [metric.task.id, metric]));
  const manualByCell = new Map(
    values.map((value) => [key(value.taskId, value.date), value]),
  );
  const dailyByCell = approvedDailyManDays(
    entries,
    project.productiveHoursPerPerson,
  );
  const startDate = minDate([
    project.originalStart,
    ...tasks.flatMap((task) => [task.originalStart, task.targetStart]),
  ]);
  const finishDate = maxDate(
    project.targetFinish,
    ...tasks.flatMap((task) => [task.targetFinish, task.originalFinish]),
    ...metrics.map((metric) => metric.displayedForecastFinish),
    ...values.map((value) => value.date),
  );
  const dates = dateRangeInclusive(startDate, finishDate);
  const projectionPivot =
    compareDates(project.statusDate, today) > 0 ? project.statusDate : today;

  const rows: ProgrammeRow[] = tasks.map((task) => {
    const metric = metricByTask.get(task.id);
    if (!metric) throw new Error(`Programme metric missing for ${task.id}.`);
    const taskValues = values.filter((value) => value.taskId === task.id);
    const latestManualDate =
      taskValues.length > 0
        ? maxDate(...taskValues.map((value) => value.date))
        : null;
    // Labour is planned in person-day equivalents. Partial source hours still
    // require a whole available person-day in the programme.
    const revisedManDays = Math.ceil(
      metric.revisedBudgetHours / project.productiveHoursPerPerson,
    );
    const fixedByDate = new Map<string, number>();

    for (const date of dates) {
      const manual = manualByCell.get(key(task.id, date));
      if (manual) {
        fixedByDate.set(date, manual.manDays);
        continue;
      }
      if (compareDates(date, project.statusDate) <= 0) {
        const actual = dailyByCell.get(key(task.id, date));
        if (actual !== undefined) fixedByDate.set(date, actual);
      }
    }

    const fixedManDays = [...fixedByDate.values()].reduce(
      (total, value) => total + value,
      0,
    );
    const remainingManDays = Math.max(0, revisedManDays - fixedManDays);
    const start = maxDate(
      addCalendarDays(projectionPivot, 1),
      task.targetStart,
      metric.defaultForecastStart,
    );
    const projectionEnabled = !["complete", "cancelled", "on-hold"].includes(
      task.status,
    );
    let allocatedThroughDate = 0;
    const cells = dates.map((date) => {
      const manual = manualByCell.get(key(task.id, date));
      if (manual) {
        allocatedThroughDate += manual.manDays;
        return {
          date,
          manDays: round(manual.manDays, 2),
          kind: "manual" as const,
          editable: true,
          note: manual.note,
        };
      }

      const actual = dailyByCell.get(key(task.id, date));
      if (
        actual !== undefined &&
        compareDates(date, project.statusDate) <= 0
      ) {
        allocatedThroughDate += actual;
        return {
          date,
          manDays: round(actual, 2),
          kind: "actual" as const,
          editable: true,
        };
      }

      const isAutomaticDate =
        projectionEnabled &&
        compareDates(date, start) >= 0 &&
        compareDates(date, task.targetFinish) <= 0 &&
        isWorkingDay(date, holidayDates);
      if (isAutomaticDate && allocatedThroughDate < revisedManDays) {
        // Automatic values are calculated left-to-right. A manual entry locks
        // that day and only changes cells after it, matching the supplied
        // workbook's rapid downstream re-planning behaviour.
        const remainingWorkingDays = dates.filter(
          (candidate) =>
            compareDates(candidate, date) >= 0 &&
            compareDates(candidate, task.targetFinish) <= 0 &&
            isWorkingDay(candidate, holidayDates),
        ).length;
        const projected =
          remainingWorkingDays > 0
            ? Math.max(
                0,
                round(
                  (revisedManDays - allocatedThroughDate) /
                    remainingWorkingDays,
                  2,
                ),
              )
            : 0;
        if (projected > 0) {
          allocatedThroughDate += projected;
          return {
            date,
            manDays: projected,
            kind: "projected" as const,
            editable: true,
          };
        }
      }

      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) {
        return {
          date,
          manDays: null,
          kind: "weekend" as const,
          editable: true,
        };
      }
      if (holidayDates.has(date)) {
        return {
          date,
          manDays: null,
          kind: "exception" as const,
          editable: true,
        };
      }
      return {
        date,
        manDays: null,
        kind: "blank" as const,
        editable: true,
      };
    });

    const scheduledManDays = cells.reduce(
      (total, cell) => total + (cell.manDays ?? 0),
      0,
    );
    const scheduledByDueDate = cells
      .filter((cell) => compareDates(cell.date, task.targetFinish) <= 0)
      .reduce((total, cell) => total + (cell.manDays ?? 0), 0);
    const planningPivot =
      latestManualDate &&
      compareDates(latestManualDate, projectionPivot) > 0
        ? latestManualDate
        : projectionPivot;
    const nextAutomatic = cells.find(
      (cell) =>
        cell.kind === "projected" &&
        compareDates(cell.date, planningPivot) > 0,
    );
    const requiredManDaysPerWorkingDay =
      nextAutomatic?.manDays ??
      (scheduledByDueDate + 0.01 < revisedManDays
        ? Number.POSITIVE_INFINITY
        : 0);
    const allocationVarianceManDays = round(
      scheduledManDays - revisedManDays,
      2,
    );
    let feasibility: ProgrammeRow["feasibility"] = "achievable";
    if (allocationVarianceManDays > 0.01) {
      feasibility = "over-allocated";
    } else if (remainingManDays <= 0) {
      feasibility = "complete";
    } else if (
      !Number.isFinite(requiredManDaysPerWorkingDay) ||
      (task.maxPracticalCrew !== null &&
        requiredManDaysPerWorkingDay > task.maxPracticalCrew)
    ) {
      feasibility = "not-achievable";
    } else if (requiredManDaysPerWorkingDay > task.assignedStaff) {
      feasibility = "needs-crew";
    }

    return {
      taskId: task.id,
      taskName: task.name,
      workPackage: task.workPackage,
      status: task.status,
      targetStart: task.targetStart,
      targetFinish: task.targetFinish,
      forecastStart: metric.displayedForecastStart,
      forecastFinish: metric.displayedForecastFinish,
      revisedManDays: round(revisedManDays, 2),
      fixedManDays: round(fixedManDays, 2),
      remainingManDays: round(remainingManDays, 2),
      scheduledManDays: round(scheduledManDays, 2),
      allocationVarianceManDays,
      requiredManDaysPerWorkingDay: Number.isFinite(
        requiredManDaysPerWorkingDay,
      )
        ? round(requiredManDaysPerWorkingDay, 2)
        : requiredManDaysPerWorkingDay,
      assignedCrew: task.assignedStaff,
      maxPracticalCrew: task.maxPracticalCrew,
      feasibility,
      latestManualDate,
      cells,
    };
  });

  return {
    today,
    startDate,
    finishDate,
    dates,
    rows,
    dailyDemand: dates.map((date) => ({
      date,
      manDays: round(
        rows.reduce((total, row) => {
          const cell = row.cells.find((item) => item.date === date);
          return total + (cell?.manDays ?? 0);
        }, 0),
        2,
      ),
    })),
  };
}
