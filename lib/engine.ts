import {
  addWorkingDays,
  compareDates,
  maxDate,
  nextWorkingDay,
  onOrNextWorkingDay,
  workingDaysInclusive,
} from "./date";
import type {
  DailyEntry,
  MaterialPackage,
  Project,
  Task,
  TaskMetric,
} from "./types";

export const ROUNDING_EPSILON = 1e-9;

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateTaskMetric({
  project,
  task,
  entries,
  materials,
  holidayDates,
  predecessorFinishDates = [],
}: {
  project: Project;
  task: Task;
  entries: DailyEntry[];
  materials: MaterialPackage[];
  holidayDates: ReadonlySet<string>;
  predecessorFinishDates?: string[];
}): TaskMetric {
  const revisedUnits = task.originalUnits + task.approvedVariationUnits;
  const revisedBudgetHours =
    task.originalBudgetHours + task.approvedVariationHours;

  const toStatus = entries.filter(
    (entry) =>
      entry.taskId === task.id &&
      compareDates(entry.date, project.statusDate) <= 0,
  );
  const approvedEntries = toStatus.filter(
    (entry) =>
      entry.variationStatus === "none" ||
      entry.variationStatus === "approved",
  );
  const atRiskEntries = toStatus.filter(
    (entry) =>
      entry.variationStatus === "at-risk" ||
      entry.variationStatus === "rejected",
  );

  const actualHours = approvedEntries.reduce(
    (total, entry) => total + entry.labourHours,
    0,
  );
  const atRiskHours = atRiskEntries.reduce(
    (total, entry) => total + entry.labourHours,
    0,
  );
  const completedUnits = approvedEntries.reduce(
    (total, entry) => total + entry.unitsCompleted,
    0,
  );
  const cappedCompletedUnits = Math.min(completedUnits, revisedUnits);
  const progressPercent =
    revisedUnits > 0 ? cappedCompletedUnits / revisedUnits : 0;
  const budgetHoursPerUnit =
    revisedUnits > 0 ? revisedBudgetHours / revisedUnits : 0;
  const earnedHours = cappedCompletedUnits * budgetHoursPerUnit;
  const productivityVariance = earnedHours - actualHours;

  let forecastBasis: TaskMetric["forecastBasis"] = "budget-rate";
  let selectedForecastHoursPerUnit = budgetHoursPerUnit;
  if (task.manualForecastRate !== null && task.manualForecastRate > 0) {
    forecastBasis = "manual";
    selectedForecastHoursPerUnit = task.manualForecastRate;
  } else if (
    (progressPercent + ROUNDING_EPSILON >= project.minimumProgressPercent ||
      cappedCompletedUnits + ROUNDING_EPSILON >=
        project.minimumProgressUnits) &&
    cappedCompletedUnits > 0
  ) {
    forecastBasis = "actual-to-date";
    selectedForecastHoursPerUnit = actualHours / cappedCompletedUnits;
  }

  const remainingUnits = Math.max(0, revisedUnits - cappedCompletedUnits);
  const forecastRemainingHours =
    remainingUnits * selectedForecastHoursPerUnit;
  const forecastTotalHours = actualHours + forecastRemainingHours;
  const forecastVariance = revisedBudgetHours - forecastTotalHours;

  const applicableMaterialDates = materials
    .filter(
      (material) =>
        material.taskIds.includes(task.id) &&
        material.status !== "delivered" &&
        material.status !== "complete",
    )
    .map(
      (material) =>
        material.confirmedDeliveryDate ??
        material.forecastNeedDate ??
        material.requiredOnSiteDate,
    );

  const defaultForecastStart = onOrNextWorkingDay(
    maxDate(
      nextWorkingDay(project.statusDate, holidayDates),
      task.targetStart,
      task.accessDate,
      ...predecessorFinishDates,
      ...applicableMaterialDates,
    ),
    holidayDates,
  );
  const displayedForecastStart =
    task.manualForecastStart ?? defaultForecastStart;

  const assignedCapacity =
    task.assignedStaff * project.productiveHoursPerPerson;
  const forecastWorkingDays =
    forecastRemainingHours <= 0
      ? 0
      : assignedCapacity > 0
        ? Math.ceil(forecastRemainingHours / assignedCapacity)
        : 0;
  const defaultForecastFinish =
    forecastRemainingHours <= 0
      ? project.statusDate
      : assignedCapacity > 0
        ? addWorkingDays(
            displayedForecastStart,
            Math.max(0, forecastWorkingDays - 1),
            holidayDates,
          )
        : displayedForecastStart;
  const displayedForecastFinish =
    task.manualForecastFinish ?? defaultForecastFinish;

  const remainingWorkingDays = workingDaysInclusive(
    displayedForecastStart,
    task.targetFinish,
    holidayDates,
  );
  const requiredStaffFte =
    forecastRemainingHours <= 0
      ? 0
      : remainingWorkingDays > 0
        ? forecastRemainingHours /
          remainingWorkingDays /
          project.productiveHoursPerPerson
        : Number.POSITIVE_INFINITY;
  const recommendedStaff = Number.isFinite(requiredStaffFte)
    ? Math.ceil(requiredStaffFte)
    : 0;

  const flags: string[] = [];
  if (actualHours > 0 && completedUnits === 0) {
    flags.push("Hours recorded with no measured progress");
  }
  if (completedUnits > revisedUnits + ROUNDING_EPSILON) {
    flags.push("Completed units exceed the approved total");
  }
  if (task.assignedStaff <= 0 && forecastRemainingHours > 0) {
    flags.push("No crew is assigned");
  }
  if (
    task.maxPracticalCrew !== null &&
    requiredStaffFte > task.maxPracticalCrew
  ) {
    flags.push("Recovery is not achievable through labour alone");
  }
  if (compareDates(displayedForecastFinish, task.targetFinish) > 0) {
    flags.push("Forecast finish is after the target");
  }
  if (task.criticality === "unknown") {
    flags.push("Criticality is not confirmed");
  }

  const varianceRatio =
    revisedBudgetHours > 0 ? productivityVariance / revisedBudgetHours : 0;
  let health: TaskMetric["health"] = "good";
  if (
    flags.some(
      (flag) =>
        flag.includes("after the target") ||
        flag.includes("not achievable") ||
        flag.includes("exceed"),
    ) ||
    varianceRatio < -0.1
  ) {
    health = "risk";
  } else if (flags.length > 0 || varianceRatio < -0.03) {
    health = "watch";
  }

  return {
    task,
    revisedUnits: round(revisedUnits, 4),
    revisedBudgetHours: round(revisedBudgetHours, 4),
    actualHours: round(actualHours, 4),
    atRiskHours: round(atRiskHours, 4),
    completedUnits: round(completedUnits, 4),
    progressPercent: round(progressPercent, 4),
    earnedHours: round(earnedHours, 4),
    productivityVariance: round(productivityVariance, 4),
    selectedForecastHoursPerUnit: round(selectedForecastHoursPerUnit, 4),
    forecastBasis,
    forecastRemainingHours: round(forecastRemainingHours, 4),
    forecastTotalHours: round(forecastTotalHours, 4),
    forecastVariance: round(forecastVariance, 4),
    requiredStaffFte: Number.isFinite(requiredStaffFte)
      ? round(requiredStaffFte, 2)
      : null,
    recommendedStaff,
    defaultForecastStart,
    defaultForecastFinish,
    displayedForecastStart,
    displayedForecastFinish,
    health,
    flags,
  };
}

export function aggregateMetrics(metrics: TaskMetric[]) {
  return metrics.reduce(
    (summary, item) => ({
      revisedBudgetHours:
        summary.revisedBudgetHours + item.revisedBudgetHours,
      actualHours: summary.actualHours + item.actualHours,
      earnedHours: summary.earnedHours + item.earnedHours,
      productivityVariance:
        summary.productivityVariance + item.productivityVariance,
      forecastTotalHours:
        summary.forecastTotalHours + item.forecastTotalHours,
      forecastVariance: summary.forecastVariance + item.forecastVariance,
      atRiskHours: summary.atRiskHours + item.atRiskHours,
    }),
    {
      revisedBudgetHours: 0,
      actualHours: 0,
      earnedHours: 0,
      productivityVariance: 0,
      forecastTotalHours: 0,
      forecastVariance: 0,
      atRiskHours: 0,
    },
  );
}
