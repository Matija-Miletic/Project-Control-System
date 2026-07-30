(function () {
  "use strict";

  const project = {
    id: "DEMO-RETAIL-2026",
    name: "Waikato Retail Fit-out Demo",
    client: "Fictional retail client",
    projectManager: "Demo Project Manager",
    siteManager: "Demo Site Manager",
    statusDate: "2026-07-30",
    originalStart: "2026-06-23",
    originalFinish: "2026-11-16",
    targetFinish: "2026-11-06",
    handoverDate: "2026-11-06",
    productiveHoursPerPerson: 8.9,
    minimumProgressPercent: 0.1,
    minimumProgressUnits: 3,
    nearCriticalDays: 5,
    hourlyRate: 60,
    currency: "NZD",
    timeZone: "Pacific/Auckland",
    workingWeek: [1, 2, 3, 4, 5],
    protectedBaselineHours: 1825.9
  };

  function task(
    id,
    name,
    workPackage,
    hours,
    units,
    trackingUom,
    start,
    finish,
    assignedStaff,
    workfront
  ) {
    return {
      id,
      name,
      workPackage,
      workfront: workfront || "Whole project",
      trackingUom,
      progressMethod: units === 1 ? "equal-units" : "continuous",
      originalUnits: units,
      approvedVariationUnits: 0,
      originalBudgetHours: hours,
      approvedVariationHours: 0,
      assignedStaff,
      maxPracticalCrew: null,
      targetStart: start,
      targetFinish: finish,
      originalStart: start,
      originalFinish: finish,
      criticality: "unknown",
      criticalitySource: "unknown",
      status: "not-started",
      manualForecastRate: null,
      manualForecastStart: null,
      manualForecastFinish: null,
      accessDate: null,
      userCreated: false
    };
  }

  const tasks = [
    task("DEMO-ST-011", "Footings, formwork and reinforcing", "Foundations & Slab", 72.4, 348.1, "lm", "2026-07-15", "2026-08-03", 1),
    task("DEMO-ST-013", "Slab edge and nib formwork", "Foundations & Slab", 69.6, 62, "lm", "2026-07-20", "2026-08-10", 1),
    task("DEMO-ST-012", "Ground slab carpentry support", "Foundations & Slab", 73, 181.9, "m²", "2026-08-04", "2026-08-07", 3),
    task("DEMO-ST-001", "External wall framing", "Superstructure & Fit-out", 156.1, 518.2, "m²", "2026-08-11", "2026-10-13", 1),
    task("DEMO-ST-003", "Roof framing and purlins", "Superstructure & Fit-out", 425.1, 727.5, "m²", "2026-08-25", "2026-08-31", 11),
    task("DEMO-ST-005", "Entry canopy framing and soffits", "Superstructure & Fit-out", 64.7, 77.3, "m²", "2026-08-25", "2026-09-25", 1),
    task("DEMO-ST-004", "Parapet framing and capping", "Superstructure & Fit-out", 22.9, 36, "lm", "2026-08-25", "2026-09-11", 1),
    task("DEMO-ST-006", "Wall cavity and cladding", "Superstructure & Fit-out", 271.2, 345, "m²", "2026-09-09", "2026-09-17", 5),
    task("DEMO-ST-002", "Internal partitions and linings", "Superstructure & Fit-out", 260.6, 728.9, "m²", "2026-09-24", "2026-10-09", 3),
    task("DEMO-ST-007", "Finishing carpentry", "Superstructure & Fit-out", 14.9, 1, "sum", "2026-10-05", "2026-10-21", 1),
    task("DEMO-ST-009", "Doors and hardware", "Superstructure & Fit-out", 34.5, 6, "ea", "2026-10-16", "2026-10-19", 3),
    task("DEMO-ST-010", "Final carpentry fit-off", "Superstructure & Fit-out", 6, 13, "ea", "2026-10-15", "2026-11-05", 1),
    task("DEMO-ST-016", "External sign foundation A", "External Works", 19.2, 1, "ea", "2026-08-14", "2026-08-24", 1),
    task("DEMO-ST-017", "External sign foundation B", "External Works", 16.7, 1, "ea", "2026-08-14", "2026-08-24", 1),
    task("DEMO-ST-018", "Services plinth formwork", "External Works", 28.3, 1, "ea", "2026-08-14", "2026-08-24", 1),
    task("DEMO-ST-019", "Landscape feature foundation", "External Works", 11, 1, "ea", "2026-08-14", "2026-08-24", 1),
    task("DEMO-ST-020", "External concrete structures", "External Works", 68.1, 4, "ea", "2026-08-14", "2026-08-24", 2),
    task("DEMO-ST-021", "Optional external feature", "External Works", 15.5, 1, "ea", "2026-08-14", "2026-08-24", 1),
    task("DEMO-ST-014", "Yard slab carpentry support", "Foundations & Slab", 9, 14.6, "m²", "2026-08-25", "2026-09-01", 1),
    task("DEMO-ST-008", "Boundary fencing", "External Works", 187.1, 141, "lm", "2026-10-12", "2026-10-23", 1)
  ];

  const taskDependencies = [
    ["DEMO-ST-013", "DEMO-ST-011"],
    ["DEMO-ST-012", "DEMO-ST-011"],
    ["DEMO-ST-001", "DEMO-ST-012"],
    ["DEMO-ST-003", "DEMO-ST-001"],
    ["DEMO-ST-005", "DEMO-ST-001"],
    ["DEMO-ST-004", "DEMO-ST-003"],
    ["DEMO-ST-006", "DEMO-ST-003"],
    ["DEMO-ST-002", "DEMO-ST-006"],
    ["DEMO-ST-007", "DEMO-ST-002"],
    ["DEMO-ST-009", "DEMO-ST-007"],
    ["DEMO-ST-010", "DEMO-ST-009"],
    ["DEMO-ST-021", "DEMO-ST-019"]
  ];

  const initial = {
    schemaVersion: 1,
    exportedAt: null,
    project,
    tasks,
    taskDependencies,
    dailyEntries: [],
    programmeDayValues: [],
    materials: [
      {
        id: "DEMO-MAT-001",
        name: "Roof framing package",
        component: "Timber and fixings",
        supplier: "Demo Building Supplies",
        leadTimeWorkingDays: 10,
        bufferWorkingDays: 3,
        taskIds: ["DEMO-ST-003"],
        requiredOnSiteDate: "2026-08-25",
        forecastNeedDate: null,
        manualNeedDate: null,
        suggestedOrderDate: "2026-08-06",
        purchaseOrderNumber: "DEMO-PO-001",
        purchaseOrderDate: "2026-08-04",
        confirmedDeliveryDate: null,
        status: "po-issued",
        critical: true,
        notes: "Fictional package included to demonstrate procurement controls."
      }
    ],
    variations: [],
    calendarExceptions: [
      {
        id: "DEMO-CAL-001",
        startDate: "2026-07-10",
        endDate: "2026-07-10",
        name: "Demonstration non-working day",
        treatment: "non-working"
      },
      {
        id: "DEMO-CAL-002",
        startDate: "2026-10-26",
        endDate: "2026-10-26",
        name: "Labour Day",
        treatment: "non-working"
      }
    ],
    auditEvents: [
      {
        id: "AUD-SEED",
        timestamp: "2026-07-30T00:00:00.000Z",
        actor: "Local user",
        entityType: "project",
        entityId: project.id,
        action: "Demo project initialised",
        before: null,
        after: { schemaVersion: 1 }
      }
    ]
  };

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  window.SPCData = {
    schemaVersion: 1,
    createDefault: function () {
      return clone(initial);
    }
  };
})();
