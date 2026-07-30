import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkingDays,
  isWorkingDay,
  subtractWorkingDays,
  workingDaysInclusive,
} from "../lib/date";
import { aggregateMetrics, calculateTaskMetric } from "../lib/engine";
import { buildProgrammeState } from "../lib/programme";
import {
  pilotEntries,
  pilotHolidayDates,
  pilotMaterials,
  pilotProject,
  pilotTaskMetrics,
  pilotTasks,
} from "../lib/sample-data";
import type { DailyEntry, Task } from "../lib/types";
import { buildLabourTrend } from "../lib/trend";

test("the fictional task baseline reconciles to the demo allowance", () => {
  const original = pilotTasks.reduce(
    (total, task) => total + task.originalBudgetHours,
    0,
  );
  assert.ok(Math.abs(original - 1825.9) < 1e-9);
  assert.ok(
    Math.abs(
      aggregateMetrics(pilotTaskMetrics).revisedBudgetHours - original,
    ) < 0.001,
  );
});

test("at-risk variation work is excluded from approved actuals", () => {
  const task = { ...pilotTasks[0], id: "TEST-AT-RISK" };
  const metric = calculateTaskMetric({
    project: pilotProject,
    task,
    entries: [
      {
        id: "TEST-APPROVED",
        taskId: task.id,
        date: pilotProject.statusDate,
        labourHours: 12,
        unitsCompleted: 4,
        reworkHours: 0,
        variationStatus: "none",
        delayReason: null,
      },
      {
        id: "TEST-AT-RISK-ENTRY",
        taskId: task.id,
        date: pilotProject.statusDate,
        labourHours: 8,
        unitsCompleted: 0,
        reworkHours: 0,
        variationStatus: "at-risk",
        delayReason: null,
      },
    ],
    materials: [],
    holidayDates: pilotHolidayDates,
  });
  assert.equal(metric.actualHours, 12);
  assert.equal(metric.atRiskHours, 8);
});

test("actual production rate starts when either configured threshold is met", () => {
  const task: Task = {
    ...pilotTasks[0],
    id: "TEST-THRESHOLD",
    originalUnits: 100,
    originalBudgetHours: 100,
    approvedVariationHours: 0,
    targetStart: "2026-09-29",
    targetFinish: "2026-10-20",
    assignedStaff: 1,
  };
  const entries: DailyEntry[] = [
    {
      id: "TEST-ENTRY",
      taskId: task.id,
      date: pilotProject.statusDate,
      labourHours: 10,
      unitsCompleted: 4,
      reworkHours: 0,
      variationStatus: "none",
      delayReason: null,
    },
  ];
  const metric = calculateTaskMetric({
    project: pilotProject,
    task,
    entries,
    materials: [],
    holidayDates: pilotHolidayDates,
  });
  assert.equal(metric.progressPercent, 0.04);
  assert.equal(metric.forecastBasis, "actual-to-date");
  assert.equal(metric.selectedForecastHoursPerUnit, 2.5);
});

test("earned hours are capped at the approved unit total and the exception remains visible", () => {
  const task = { ...pilotTasks[0], id: "TEST-CAP", originalUnits: 10 };
  const metric = calculateTaskMetric({
    project: pilotProject,
    task,
    entries: [
      {
        id: "TEST-CAP-ENTRY",
        taskId: task.id,
        date: pilotProject.statusDate,
        labourHours: 25,
        unitsCompleted: 12,
        reworkHours: 0,
        variationStatus: "none",
        delayReason: null,
      },
    ],
    materials: [],
    holidayDates: pilotHolidayDates,
  });
  assert.equal(metric.progressPercent, 1);
  assert.ok(Math.abs(metric.earnedHours - task.originalBudgetHours) < 0.0001);
  assert.ok(
    metric.flags.includes("Completed units exceed the approved total"),
  );
});

test("an unexplained hours-without-progress line is flagged", () => {
  const task = { ...pilotTasks[0], id: "TEST-NO-PROGRESS" };
  const metric = calculateTaskMetric({
    project: pilotProject,
    task,
    entries: [
      {
        id: "TEST-NO-PROGRESS-ENTRY",
        taskId: task.id,
        date: pilotProject.statusDate,
        labourHours: 8,
        unitsCompleted: 0,
        reworkHours: 0,
        variationStatus: "none",
        delayReason: null,
      },
    ],
    materials: [],
    holidayDates: pilotHolidayDates,
  });
  assert.ok(
    metric.flags.includes("Hours recorded with no measured progress"),
  );
});

test("a material availability date constrains forecast start", () => {
  const doorTask = pilotTasks.find((task) => task.id === "DEMO-ST-009");
  assert.ok(doorTask);
  const metric = calculateTaskMetric({
    project: pilotProject,
    task: doorTask,
    entries: pilotEntries,
    materials: [
      {
        id: "TEST-DOORS",
        name: "Doors and hardware",
        taskIds: [doorTask.id],
        component: "Doors",
        supplier: "Test supplier",
        leadTimeWorkingDays: 10,
        bufferWorkingDays: 2,
        requiredOnSiteDate: "2026-10-19",
        suggestedOrderDate: "2026-10-01",
        purchaseOrderNumber: null,
        purchaseOrderDate: null,
        status: "in-production",
        confirmedDeliveryDate: null,
        forecastNeedDate: "2026-10-20",
        critical: true,
      },
    ],
    holidayDates: pilotHolidayDates,
  });
  assert.equal(metric.defaultForecastStart, "2026-10-20");
});

test("working-day arithmetic skips weekends and configured holidays", () => {
  assert.equal(isWorkingDay("2026-07-10", pilotHolidayDates), false);
  assert.equal(addWorkingDays("2026-07-09", 1, pilotHolidayDates), "2026-07-13");
  assert.equal(
    subtractWorkingDays("2026-10-27", 1, pilotHolidayDates),
    "2026-10-23",
  );
  assert.equal(
    workingDaysInclusive("2026-10-23", "2026-10-27", pilotHolidayDates),
    2,
  );
});

test("zero-capacity remaining work serialises as a null labour requirement", () => {
  const task = {
    ...pilotTasks[7],
    id: "TEST-NO-CAPACITY",
    assignedStaff: 0,
    targetFinish: "2026-09-01",
  };
  const metric = calculateTaskMetric({
    project: pilotProject,
    task,
    entries: [],
    materials: [],
    holidayDates: pilotHolidayDates,
  });
  assert.equal(metric.requiredStaffFte, null);
  assert.ok(metric.flags.includes("No crew is assigned"));
  assert.doesNotThrow(() => JSON.stringify(metric));
});

test("the trend status point is derived from controlled entries", () => {
  const programme = buildProgrammeState({
    project: pilotProject,
    tasks: pilotTasks,
    metrics: pilotTaskMetrics,
    entries: pilotEntries,
    values: [],
    holidayDates: pilotHolidayDates,
    today: pilotProject.statusDate,
  });
  const points = buildLabourTrend({
    project: pilotProject,
    tasks: pilotTasks,
    entries: pilotEntries,
    materials: pilotMaterials,
    variations: [],
    calendarExceptions: [],
    holidayDates: [...pilotHolidayDates],
    programmeDayValues: [],
    programme,
    metrics: pilotTaskMetrics,
    checks: [],
    lastUpdatedAt: pilotProject.statusDate,
  });
  const status = points.at(-1);
  assert.ok(status);
  const summary = aggregateMetrics(pilotTaskMetrics);
  assert.equal(status.actual, Math.round(summary.actualHours * 10) / 10);
  assert.equal(status.earned, Math.round(summary.earnedHours * 10) / 10);
});
