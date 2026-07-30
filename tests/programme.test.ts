import assert from "node:assert/strict";
import test from "node:test";
import { calculateTaskMetric } from "../lib/engine";
import {
  applyProgrammeActualOverrides,
  buildProgrammeState,
} from "../lib/programme";
import { pilotProject, pilotTasks } from "../lib/sample-data";
import type {
  DailyEntry,
  ProgrammeDayValue,
  Task,
} from "../lib/types";

const project = {
  ...pilotProject,
  statusDate: "2026-07-27",
  originalStart: "2026-07-27",
  originalFinish: "2026-08-07",
  targetFinish: "2026-08-07",
  handoverDate: "2026-08-07",
};

const task: Task = {
  ...pilotTasks[0],
  id: "PROGRAMME-TEST",
  name: "Programme test task",
  originalUnits: 100,
  originalBudgetHours: 89,
  approvedVariationHours: 0,
  approvedVariationUnits: 0,
  assignedStaff: 2,
  maxPracticalCrew: 3,
  originalStart: "2026-07-27",
  targetStart: "2026-07-27",
  originalFinish: "2026-08-07",
  targetFinish: "2026-08-07",
  status: "in-progress",
};

function state(values: ProgrammeDayValue[], holidayDates = new Set<string>()) {
  const metric = calculateTaskMetric({
    project,
    task,
    entries: [],
    materials: [],
    holidayDates,
  });
  return buildProgrammeState({
    project,
    tasks: [task],
    metrics: [metric],
    entries: [],
    values,
    holidayDates,
    today: "2026-07-28",
  });
}

function manual(date: string, manDays: number): ProgrammeDayValue {
  return {
    taskId: task.id,
    date,
    manDays,
    note: "",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

test("manual man-days are fixed and automatic weekdays reconcile to the budget", () => {
  const programme = state([manual("2026-07-29", 4)]);
  const row = programme.rows[0];
  assert.equal(
    row.cells.find((cell) => cell.date === "2026-07-29")?.kind,
    "manual",
  );
  const allocated = row.cells
    .filter((cell) => cell.date <= task.targetFinish)
    .reduce((total, cell) => total + (cell.manDays ?? 0), 0);
  assert.ok(Math.abs(allocated - 10) < 0.01);
  assert.equal(row.remainingManDays, 6);
});

test("default projection is the equal weekday requirement to meet the due date", () => {
  const row = state([]).rows[0];
  assert.equal(row.requiredManDaysPerWorkingDay, 1.25);
  assert.equal(
    row.cells.find((cell) => cell.date === "2026-07-29")?.manDays,
    1.25,
  );
  assert.equal(row.scheduledManDays, 10);
});

test("a future manual entry recalculates downstream cells without changing upstream days", () => {
  const baseline = state([]).rows[0];
  const replanned = state([manual("2026-08-03", 4)]).rows[0];
  for (const date of ["2026-07-29", "2026-07-30", "2026-07-31"]) {
    assert.equal(
      replanned.cells.find((cell) => cell.date === date)?.manDays,
      baseline.cells.find((cell) => cell.date === date)?.manDays,
    );
  }
  assert.equal(
    replanned.cells.find((cell) => cell.date === "2026-08-03")?.kind,
    "manual",
  );
  assert.equal(replanned.requiredManDaysPerWorkingDay, 0.56);
  assert.equal(replanned.scheduledManDays, 10);
});

test("zero is a deliberate manual allocation and redistributes later work", () => {
  const programme = state([manual("2026-07-29", 0)]);
  const row = programme.rows[0];
  const blocked = row.cells.find((cell) => cell.date === "2026-07-29");
  assert.equal(blocked?.kind, "manual");
  assert.equal(blocked?.manDays, 0);
  assert.ok(
    (row.cells.find((cell) => cell.date === "2026-07-30")?.manDays ?? 0) >
      1,
  );
});

test("weekends and exception dates stay empty until deliberately entered", () => {
  const holiday = "2026-07-31";
  const programme = state([], new Set([holiday]));
  const row = programme.rows[0];
  assert.equal(
    row.cells.find((cell) => cell.date === holiday)?.kind,
    "exception",
  );
  assert.equal(
    row.cells.find((cell) => cell.date === "2026-08-01")?.kind,
    "weekend",
  );

  const withWeekend = state(
    [manual("2026-08-01", 1.5)],
    new Set([holiday]),
  );
  assert.equal(
    withWeekend.rows[0].cells.find((cell) => cell.date === "2026-08-01")
      ?.kind,
    "manual",
  );
});

test("a past programme value replaces approved labour hours but retains progress", () => {
  const entries: DailyEntry[] = [
    {
      id: "approved",
      taskId: task.id,
      date: "2026-07-27",
      labourHours: 8.9,
      unitsCompleted: 12,
      reworkHours: 1,
      variationStatus: "none",
      delayReason: "Access",
    },
    {
      id: "at-risk",
      taskId: task.id,
      date: "2026-07-27",
      labourHours: 3,
      unitsCompleted: 0,
      reworkHours: 0,
      variationStatus: "at-risk",
      delayReason: null,
    },
  ];
  const result = applyProgrammeActualOverrides({
    entries,
    values: [manual("2026-07-27", 2)],
    project,
  });
  const replacement = result.find((entry) => entry.id.startsWith("PROGRAMME"));
  assert.equal(replacement?.labourHours, 17.8);
  assert.equal(replacement?.unitsCompleted, 12);
  assert.equal(replacement?.delayReason, "Access");
  assert.ok(result.some((entry) => entry.id === "at-risk"));
});

test("manual allocations above the task allowance are exposed as over-allocated", () => {
  const row = state([manual("2026-07-29", 11)]).rows[0];
  assert.equal(row.feasibility, "over-allocated");
  assert.equal(row.allocationVarianceManDays, 1);
});
