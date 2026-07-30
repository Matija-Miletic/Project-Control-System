(function (root) {
  "use strict";

  function run() {
    const E = root.SPCEngine;
    const create = root.SPCData.createDefault;
    const tests = [];

    function test(name, fn) {
      try {
        fn();
        tests.push({ name, ok: true });
      } catch (error) {
        tests.push({
          name,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    function equal(actual, expected, message) {
      if (actual !== expected) {
        throw new Error((message || "Values differ") + ": expected " +
          expected + ", received " + actual);
      }
    }

    function close(actual, expected, tolerance, message) {
      if (Math.abs(actual - expected) > tolerance) {
        throw new Error((message || "Values differ") + ": expected " +
          expected + " ± " + tolerance + ", received " + actual);
      }
    }

    test("Imported demonstration baseline reconciles to 1,825.9 hours", function () {
      const state = create();
      const total = state.tasks.reduce(function (sum, task) {
        return sum + task.originalBudgetHours;
      }, 0);
      close(total, 1825.9, 0.0001);
    });

    test("One man-day is configured as 8.9 labour hours", function () {
      equal(create().project.productiveHoursPerPerson, 8.9);
    });

    test("Task man-days round up from source hours", function () {
      const result = E.derive(create(), "2026-07-30");
      const row = result.programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-011";
      });
      equal(row.revisedManDays, Math.ceil(72.4 / 8.9));
    });

    test("Default projections skip weekends", function () {
      const result = E.derive(create(), "2026-07-30");
      const row = result.programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-003";
      });
      const saturday = row.cells.find(function (cell) {
        return cell.date === "2026-08-29";
      });
      equal(saturday.kind, "weekend");
      equal(saturday.manDays, null);
    });

    test("A manual weekend value remains editable and fixed", function () {
      const state = create();
      state.programmeDayValues.push({
        taskId: "DEMO-ST-003",
        date: "2026-08-29",
        manDays: 1.5,
        note: "Saturday shift",
        updatedAt: "2026-07-30T00:00:00.000Z"
      });
      const result = E.derive(state, "2026-07-30");
      const row = result.programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-003";
      });
      const cell = row.cells.find(function (item) { return item.date === "2026-08-29"; });
      equal(cell.kind, "manual");
      equal(cell.manDays, 1.5);
    });

    test("A manual zero deliberately blocks the selected day", function () {
      const state = create();
      state.programmeDayValues.push({
        taskId: "DEMO-ST-003",
        date: "2026-08-27",
        manDays: 0,
        note: "Blocked",
        updatedAt: "2026-07-30T00:00:00.000Z"
      });
      const row = E.derive(state, "2026-07-30").programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-003";
      });
      const cell = row.cells.find(function (item) { return item.date === "2026-08-27"; });
      equal(cell.kind, "manual");
      equal(cell.manDays, 0);
    });

    test("Later weekdays recalculate after a manual planning point", function () {
      const state = create();
      state.programmeDayValues.push({
        taskId: "DEMO-ST-020",
        date: "2026-08-18",
        manDays: 5,
        note: "Manual plan",
        updatedAt: "2026-07-30T00:00:00.000Z"
      });
      const row = E.derive(state, "2026-07-30").programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-020";
      });
      const pivot = row.cells.find(function (cell) { return cell.date === "2026-08-18"; });
      const later = row.cells.find(function (cell) { return cell.date === "2026-08-19"; });
      equal(pivot.manDays, 5);
      equal(pivot.kind, "manual");
      equal(later.kind, "projected");
      if (!(later.manDays > 0)) throw new Error("Later automatic day was not populated.");
    });

    test("Inclusive calendar ranges become non-working dates", function () {
      const state = create();
      state.calendarExceptions.push({
        id: "TEST-CAL",
        startDate: "2026-08-25",
        endDate: "2026-08-26",
        name: "Delay",
        treatment: "non-working"
      });
      const result = E.derive(state, "2026-07-30");
      equal(result.exceptionDates.has("2026-08-25"), true);
      equal(result.exceptionDates.has("2026-08-26"), true);
      const row = result.programme.rows.find(function (item) {
        return item.taskId === "DEMO-ST-003";
      });
      equal(row.cells.find(function (cell) { return cell.date === "2026-08-25"; }).kind, "exception");
    });

    test("Approved variations change only the linked revised allowance", function () {
      const state = create();
      state.variations.push({
        id: "VO-001",
        taskId: "DEMO-ST-011",
        title: "Approved test",
        status: "approved",
        submittedHours: 8.9,
        approvedHours: 8.9,
        approvedUnits: 10,
        exposureHours: 8.9,
        criticalPathImpact: "no",
        clientResponseDue: null,
        description: null
      });
      const result = E.derive(state, "2026-07-30");
      const metric = result.metrics.find(function (item) {
        return item.task.id === "DEMO-ST-011";
      });
      close(metric.revisedBudgetHours, 81.3, 0.0001);
      close(metric.revisedUnits, 358.1, 0.0001);
      equal(state.tasks.find(function (task) {
        return task.id === "DEMO-ST-013";
      }).approvedVariationHours, 0);
    });

    test("Actual-rate forecasting activates at the progress threshold", function () {
      const state = create();
      state.dailyEntries.push({
        id: "TEST-DE",
        taskId: "DEMO-ST-011",
        date: "2026-07-30",
        labourHours: 8.9,
        unitsCompleted: 34.81,
        reworkHours: 0,
        variationId: null,
        variationStatus: "none",
        delayReason: null,
        workfront: "Whole project",
        notes: null
      });
      const metric = E.derive(state, "2026-07-30").metrics.find(function (item) {
        return item.task.id === "DEMO-ST-011";
      });
      equal(metric.forecastBasis, "actual-to-date");
      close(metric.actualHours, 8.9, 0.0001);
      close(metric.progressPercent, 0.1, 0.0001);
    });

    test("Material order date uses lead plus buffer working days", function () {
      const state = create();
      E.updateMaterialOrderDates(state);
      equal(state.materials[0].suggestedOrderDate, "2026-08-06");
    });

    test("Unsupported backup schema is rejected", function () {
      const state = create();
      state.schemaVersion = 99;
      let threw = false;
      try {
        E.validateSnapshot(state);
      } catch (error) {
        threw = true;
      }
      equal(threw, true);
    });

    return tests;
  }

  root.SPCTests = { run };
  if (typeof module !== "undefined" && module.exports) module.exports = { run };
})(typeof window !== "undefined" ? window : globalThis);
