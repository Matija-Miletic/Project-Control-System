import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  auditEvents,
  calendarExceptions,
  dailyEntries,
  holidays,
  materialPackages,
  materialTasks,
  programmeDayValues,
  projects,
  taskDependencies,
  tasks,
  variationAllocations,
  variations,
} from "../db/schema";
import { calculateTaskMetric } from "./engine";
import { compareDates, dateRangeInclusive, nzToday } from "./date";
import {
  applyProgrammeActualOverrides,
  buildProgrammeState,
} from "./programme";
import { ensurePilotSeed } from "./seed";
import type {
  ControlCheck,
  ControlState,
  CalendarException,
  DailyEntry,
  MaterialPackage,
  Project,
  Task,
  TaskMetric,
  Variation,
} from "./types";

const PILOT_ID = "DEMO-RETAIL-2026";
const SOURCE_BASELINE_HOURS = 1825.9;

function asProject(row: typeof projects.$inferSelect): Project {
  return {
    ...row,
    displayMode: row.displayMode as Project["displayMode"],
  };
}

function asTask(row: typeof tasks.$inferSelect): Task {
  return {
    ...row,
    progressMethod: row.progressMethod as Task["progressMethod"],
    criticality: row.criticality as Task["criticality"],
    criticalitySource:
      row.criticalitySource as Task["criticalitySource"],
    status: row.status as Task["status"],
  };
}

function asEntry(row: typeof dailyEntries.$inferSelect): DailyEntry {
  return {
    ...row,
    variationStatus:
      row.variationStatus as DailyEntry["variationStatus"],
  };
}

function asVariation(
  row: typeof variations.$inferSelect,
  allocation?: typeof variationAllocations.$inferSelect,
): Variation {
  return {
    ...row,
    taskId: allocation?.taskId,
    approvedUnits: allocation?.approvedUnits ?? 0,
    status: row.status as Variation["status"],
    criticalPathImpact:
      row.criticalPathImpact as Variation["criticalPathImpact"],
  };
}

function createChecks({
  project,
  tasks: projectTasks,
  entries,
  materials,
  variations: projectVariations,
  metrics,
  approvedAllocationHours,
}: {
  project: Project;
  tasks: Task[];
  entries: DailyEntry[];
  materials: MaterialPackage[];
  variations: Variation[];
  metrics: TaskMetric[];
  approvedAllocationHours: number;
}): ControlCheck[] {
  const checks: ControlCheck[] = [];
  const add = (check: ControlCheck) => checks.push(check);
  const originalHours = projectTasks.reduce(
    (total, task) => total + task.originalBudgetHours,
    0,
  );

  if (Math.abs(originalHours - SOURCE_BASELINE_HOURS) > 0.005) {
    add({
      id: "costing-source-reconciliation",
      severity: "critical",
      area: "costing",
      title: "Imported hours no longer reconcile",
      detail: `Task baseline is ${originalHours.toFixed(4)} h; the protected source total is ${SOURCE_BASELINE_HOURS.toFixed(4)} h.`,
      href: "/setup",
    });
  }

  const approvedTaskHours = projectTasks.reduce(
    (total, task) => total + task.approvedVariationHours,
    0,
  );
  if (Math.abs(approvedTaskHours - approvedAllocationHours) > 0.005) {
    add({
      id: "variation-allocation-reconciliation",
      severity: "critical",
      area: "variations",
      title: "Approved variation hours are not fully allocated",
      detail: `${approvedAllocationHours.toFixed(1)} h are allocated against ${approvedTaskHours.toFixed(1)} h in revised task budgets.`,
      href: "/variations",
    });
  }

  const boundaryFencing = projectTasks.find(
    (task) => task.id === "DEMO-ST-008",
  );
  if (boundaryFencing?.criticalitySource === "unknown") {
    add({
      id: "boundary-fencing-target-confirmation",
      severity: "warning",
      area: "setup",
      title: "Boundary fencing dates require confirmation",
      detail:
        "This demo task intentionally has unknown criticality. Confirm its target dates in Task controls before relying on the forecast.",
      href: "/setup",
    });
  }

  for (const entry of entries) {
    if (entry.labourHours > 0 && entry.unitsCompleted === 0) {
      add({
        id: `entry-hours-no-progress-${entry.id}`,
        severity: entry.delayReason ? "information" : "warning",
        area: "daily",
        title: "Hours recorded without measured progress",
        detail: `${entry.labourHours.toFixed(1)} h on ${entry.date}${entry.delayReason ? `; reason: ${entry.delayReason}` : ""}.`,
        href: "/daily",
      });
    }
    if (entry.labourHours === 0 && entry.unitsCompleted > 0) {
      add({
        id: `entry-progress-no-hours-${entry.id}`,
        severity: "warning",
        area: "daily",
        title: "Progress recorded without labour hours",
        detail: `${entry.unitsCompleted} units on ${entry.date}. Confirm whether this is a correction.`,
        href: "/daily",
      });
    }
  }

  for (const metric of metrics) {
    for (const [index, flag] of metric.flags.entries()) {
      add({
        id: `task-${metric.task.id}-${index}`,
        severity:
          flag.includes("after the target") ||
          flag.includes("not achievable") ||
          flag.includes("exceed")
            ? "critical"
            : "warning",
        area: "programme",
        title: metric.task.name,
        detail: flag,
        href: "/programme",
      });
    }
  }

  for (const material of materials) {
    if (material.taskIds.length === 0 || !material.requiredOnSiteDate) {
      add({
        id: `material-setup-${material.id}`,
        severity: material.critical ? "critical" : "warning",
        area: "materials",
        title: `${material.name} needs setup`,
        detail: `${material.taskIds.length === 0 ? "Link a controlling task. " : ""}${!material.requiredOnSiteDate ? "Enter the required-on-site date." : ""}`.trim(),
        href: "/materials",
      });
    }
    if (
      !material.purchaseOrderDate &&
      !material.purchaseOrderNumber &&
      material.suggestedOrderDate &&
      compareDates(material.suggestedOrderDate, project.statusDate) <= 0
    ) {
      add({
        id: `material-po-${material.id}`,
        severity: material.critical ? "critical" : "warning",
        area: "materials",
        title: `${material.name} is not ordered`,
        detail: `Suggested order date was ${material.suggestedOrderDate}.`,
        href: "/materials",
      });
    }
    if (
      material.confirmedDeliveryDate &&
      material.requiredOnSiteDate &&
      compareDates(
        material.confirmedDeliveryDate,
        material.requiredOnSiteDate,
      ) > 0
    ) {
      add({
        id: `material-delivery-${material.id}`,
        severity: material.critical ? "critical" : "warning",
        area: "materials",
        title: `${material.name} delivery is late`,
        detail: `Confirmed ${material.confirmedDeliveryDate}; target need was ${material.requiredOnSiteDate}.`,
        href: "/materials",
      });
    }
  }

  for (const variation of projectVariations) {
    if (
      variation.clientResponseDue &&
      compareDates(variation.clientResponseDue, project.statusDate) < 0 &&
      !["approved", "rejected", "closed", "paid"].includes(variation.status)
    ) {
      add({
        id: `variation-due-${variation.id}`,
        severity: "warning",
        area: "variations",
        title: `${variation.id} response is overdue`,
        detail: `${variation.title}; response was due ${variation.clientResponseDue}.`,
        href: "/variations",
      });
    }
  }

  return checks.sort((a, b) => {
    const rank = { critical: 0, warning: 1, information: 2 };
    return rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title);
  });
}

export async function loadControlState(): Promise<ControlState> {
  await ensurePilotSeed();
  const db = getDb();

  const [
    projectRows,
    taskRows,
    entryRows,
    materialRows,
    materialTaskRows,
    variationRows,
    holidayRows,
    calendarExceptionRows,
    programmeDayRows,
    dependencyRows,
    allocationRows,
    latestAuditRows,
  ] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, PILOT_ID)).limit(1),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, PILOT_ID))
      .orderBy(asc(tasks.sortOrder)),
    db
      .select()
      .from(dailyEntries)
      .where(eq(dailyEntries.projectId, PILOT_ID))
      .orderBy(desc(dailyEntries.date), desc(dailyEntries.createdAt)),
    db
      .select()
      .from(materialPackages)
      .where(eq(materialPackages.projectId, PILOT_ID))
      .orderBy(asc(materialPackages.targetNeedDate)),
    db.select().from(materialTasks),
    db
      .select()
      .from(variations)
      .where(eq(variations.projectId, PILOT_ID))
      .orderBy(desc(variations.updatedAt)),
    db.select().from(holidays).where(eq(holidays.projectId, PILOT_ID)),
    db
      .select()
      .from(calendarExceptions)
      .where(eq(calendarExceptions.projectId, PILOT_ID))
      .orderBy(asc(calendarExceptions.startDate)),
    db
      .select()
      .from(programmeDayValues)
      .where(eq(programmeDayValues.projectId, PILOT_ID))
      .orderBy(asc(programmeDayValues.date)),
    db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.projectId, PILOT_ID)),
    db.select().from(variationAllocations),
    db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, PILOT_ID))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1),
  ]);

  if (!projectRows[0]) {
    throw new Error("The demonstration project could not be initialised.");
  }

  const project = asProject(projectRows[0]);
  // Zero-labour source lines are retained for traceability but are not shown as
  // controllable work packages.
  const projectTasks = taskRows
    .map(asTask)
    .filter((task) => task.originalBudgetHours > 0 || task.userCreated);
  const entries = entryRows.map(asEntry);
  const projectCalendarExceptions: CalendarException[] =
    calendarExceptionRows.map((row) => ({
      id: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      name: row.name,
      treatment: "non-working",
    }));
  const holidayDates = [
    ...new Set([
      ...holidayRows.map((row) => row.date),
      ...projectCalendarExceptions.flatMap((exception) =>
        dateRangeInclusive(exception.startDate, exception.endDate),
      ),
    ]),
  ].sort();
  const holidaySet = new Set(holidayDates);
  const projectProgrammeDayValues = programmeDayRows.map((row) => ({
    taskId: row.taskId,
    date: row.date,
    manDays: row.manDays,
    note: row.note,
    updatedAt: row.updatedAt,
  }));
  const metricEntries = applyProgrammeActualOverrides({
    entries,
    values: projectProgrammeDayValues,
    project,
  });
  const materialTaskMap = new Map<string, string[]>();
  for (const row of materialTaskRows) {
    const current = materialTaskMap.get(row.materialId) ?? [];
    current.push(row.taskId);
    materialTaskMap.set(row.materialId, current);
  }
  const materials: MaterialPackage[] = materialRows.map((row) => ({
    id: row.id,
    name: row.name,
    taskIds: materialTaskMap.get(row.id) ?? [],
    component: row.component,
    supplier: row.supplier,
    leadTimeWorkingDays: row.leadTimeWorkingDays,
    bufferWorkingDays: row.bufferWorkingDays,
    requiredOnSiteDate: row.targetNeedDate || null,
    forecastNeedDate: row.forecastNeedDate,
    manualNeedDate: row.manualNeedDate,
    suggestedOrderDate: row.suggestedOrderDate || null,
    purchaseOrderNumber: row.purchaseOrderNumber,
    purchaseOrderDate: row.purchaseOrderDate,
    confirmedDeliveryDate: row.confirmedDeliveryDate,
    status: row.status as MaterialPackage["status"],
    critical: row.critical,
    notes: row.notes,
  }));
  const projectVariations = variationRows.map((row) =>
    asVariation(
      row,
      allocationRows.find((allocation) => allocation.variationId === row.id),
    ),
  );

  const metricsByTask = new Map<string, TaskMetric>();
  const metrics = projectTasks.map((task) => {
    const predecessorFinishDates = dependencyRows
      .filter((row) => row.taskId === task.id)
      .map(
        (row) =>
          metricsByTask.get(row.predecessorTaskId)?.displayedForecastFinish,
      )
      .filter((date): date is string => Boolean(date));
    const metric = calculateTaskMetric({
      project,
      task,
      entries: metricEntries,
      materials,
      holidayDates: holidaySet,
      predecessorFinishDates,
    });
    metricsByTask.set(task.id, metric);
    return metric;
  });

  const approvedAllocationHours = allocationRows.reduce(
    (total, row) => total + row.approvedHours,
    0,
  );
  const checks = createChecks({
    project,
    tasks: projectTasks,
    entries,
    materials,
    variations: projectVariations,
    metrics,
    approvedAllocationHours,
  });
  const programme = buildProgrammeState({
    project,
    tasks: projectTasks,
    metrics,
    entries,
    values: projectProgrammeDayValues,
    holidayDates: holidaySet,
    today: nzToday(),
  });

  return {
    project,
    tasks: projectTasks,
    entries,
    materials,
    variations: projectVariations,
    calendarExceptions: projectCalendarExceptions,
    holidayDates,
    programmeDayValues: projectProgrammeDayValues,
    programme,
    metrics,
    checks,
    lastUpdatedAt: latestAuditRows[0]?.createdAt ?? projectRows[0].updatedAt,
  };
}
