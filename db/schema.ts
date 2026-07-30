import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * The schema deliberately keeps original, approved and forecast values in
 * separate columns/tables. A forecast must never rewrite the tender baseline,
 * and an approved variation must remain traceable to the decision that changed
 * the controlled budget.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  client: text("client").notNull().default(""),
  projectManager: text("project_manager").notNull().default(""),
  siteManager: text("site_manager").notNull().default(""),
  statusDate: text("status_date").notNull(),
  originalStart: text("original_start").notNull(),
  originalFinish: text("original_finish").notNull(),
  targetFinish: text("target_finish").notNull(),
  handoverDate: text("handover_date").notNull(),
  productiveHoursPerPerson: real("productive_hours_per_person")
    .notNull()
    .default(8),
  minimumProgressPercent: real("minimum_progress_percent")
    .notNull()
    .default(0.1),
  minimumProgressUnits: real("minimum_progress_units").notNull().default(3),
  nearCriticalDays: integer("near_critical_days").notNull().default(5),
  displayMode: text("display_mode").notNull().default("hours"),
  hourlyRate: real("hourly_rate"),
  sourceNotes: text("source_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const holidays = sqliteTable(
  "holidays",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    name: text("name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.date] })],
);

export const calendarExceptions = sqliteTable(
  "calendar_exceptions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    name: text("name").notNull(),
    treatment: text("treatment").notNull().default("non-working"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("calendar_exceptions_project_start_idx").on(
      table.projectId,
      table.startDate,
    ),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workPackage: text("work_package").notNull(),
    workfront: text("workfront").notNull().default("Whole project"),
    trackingUom: text("tracking_uom").notNull(),
    progressMethod: text("progress_method").notNull(),
    originalUnits: real("original_units").notNull(),
    approvedVariationUnits: real("approved_variation_units")
      .notNull()
      .default(0),
    originalBudgetHours: real("original_budget_hours").notNull(),
    approvedVariationHours: real("approved_variation_hours")
      .notNull()
      .default(0),
    assignedStaff: real("assigned_staff").notNull().default(0),
    maxPracticalCrew: real("max_practical_crew"),
    targetStart: text("target_start").notNull(),
    targetFinish: text("target_finish").notNull(),
    originalStart: text("original_start").notNull(),
    originalFinish: text("original_finish").notNull(),
    criticality: text("criticality").notNull().default("unknown"),
    criticalitySource: text("criticality_source")
      .notNull()
      .default("unknown"),
    status: text("status").notNull().default("not-started"),
    manualForecastRate: real("manual_forecast_rate"),
    manualForecastStart: text("manual_forecast_start"),
    manualForecastFinish: text("manual_forecast_finish"),
    forecastOverrideReason: text("forecast_override_reason"),
    accessDate: text("access_date"),
    userCreated: integer("user_created", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tasks_project_sort_idx").on(table.projectId, table.sortOrder),
    index("tasks_project_finish_idx").on(table.projectId, table.targetFinish),
  ],
);

export const programmeDayValues = sqliteTable(
  "programme_day_values",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    manDays: real("man_days").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.taskId, table.date] }),
    index("programme_day_values_project_date_idx").on(
      table.projectId,
      table.date,
    ),
    index("programme_day_values_task_date_idx").on(table.taskId, table.date),
  ],
);

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    predecessorTaskId: text("predecessor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").notNull().default("FS"),
    lagWorkingDays: integer("lag_working_days").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.taskId, table.predecessorTaskId, table.dependencyType],
    }),
    index("dependencies_predecessor_idx").on(table.predecessorTaskId),
  ],
);

export const variations = sqliteTable(
  "variations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("potential"),
    submittedHours: real("submitted_hours").notNull().default(0),
    approvedHours: real("approved_hours").notNull().default(0),
    exposureHours: real("exposure_hours").notNull().default(0),
    criticalPathImpact: text("critical_path_impact")
      .notNull()
      .default("unknown"),
    clientResponseDue: text("client_response_due"),
    instructionReference: text("instruction_reference"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("variations_project_status_idx").on(table.projectId, table.status),
  ],
);

export const variationAllocations = sqliteTable(
  "variation_allocations",
  {
    variationId: text("variation_id")
      .notNull()
      .references(() => variations.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    submittedHours: real("submitted_hours").notNull().default(0),
    approvedHours: real("approved_hours").notNull().default(0),
    approvedUnits: real("approved_units").notNull().default(0),
    exposureHours: real("exposure_hours").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.variationId, table.taskId] }),
    index("variation_allocations_task_idx").on(table.taskId),
  ],
);

export const dailyEntries = sqliteTable(
  "daily_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    date: text("date").notNull(),
    workfront: text("workfront").notNull().default("Whole project"),
    labourHours: real("labour_hours").notNull().default(0),
    unitsCompleted: real("units_completed").notNull().default(0),
    reworkHours: real("rework_hours").notNull().default(0),
    variationId: text("variation_id").references(() => variations.id, {
      onDelete: "set null",
    }),
    variationStatus: text("variation_status").notNull().default("none"),
    delayReason: text("delay_reason"),
    notes: text("notes").notNull().default(""),
    dedupeKey: text("dedupe_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("daily_entries_dedupe_idx").on(table.dedupeKey),
    index("daily_entries_project_date_idx").on(table.projectId, table.date),
    index("daily_entries_task_date_idx").on(table.taskId, table.date),
  ],
);

export const materialPackages = sqliteTable(
  "material_packages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    component: text("component").notNull().default("Package"),
    supplier: text("supplier").notNull().default(""),
    leadTimeWorkingDays: integer("lead_time_working_days").notNull().default(0),
    bufferWorkingDays: integer("buffer_working_days").notNull().default(0),
    targetNeedDate: text("target_need_date").notNull(),
    forecastNeedDate: text("forecast_need_date"),
    manualNeedDate: text("manual_need_date"),
    suggestedOrderDate: text("suggested_order_date").notNull(),
    purchaseOrderNumber: text("purchase_order_number"),
    purchaseOrderDate: text("purchase_order_date"),
    confirmedDeliveryDate: text("confirmed_delivery_date"),
    status: text("status").notNull().default("not-identified"),
    critical: integer("critical", { mode: "boolean" }).notNull().default(false),
    notes: text("notes").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("materials_project_status_idx").on(table.projectId, table.status),
    index("materials_project_need_idx").on(table.projectId, table.targetNeedDate),
  ],
);

export const materialTasks = sqliteTable(
  "material_tasks",
  {
    materialId: text("material_id")
      .notNull()
      .references(() => materialPackages.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.materialId, table.taskId] }),
    index("material_tasks_task_idx").on(table.taskId),
  ],
);

export const costingLines = sqliteTable(
  "costing_lines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSheet: text("source_sheet").notNull(),
    sourceRow: integer("source_row").notNull(),
    sourceReference: text("source_reference").notNull().default(""),
    description: text("description").notNull(),
    workSection: text("work_section").notNull(),
    packageName: text("package_name").notNull(),
    originalLabourValue: real("original_labour_value"),
    importedBudgetHours: real("imported_budget_hours").notNull(),
    importRate: real("import_rate"),
  },
  (table) => [
    uniqueIndex("costing_source_row_idx").on(
      table.projectId,
      table.sourceSheet,
      table.sourceRow,
    ),
    index("costing_project_section_idx").on(table.projectId, table.workSection),
  ],
);

export const costingAllocations = sqliteTable(
  "costing_allocations",
  {
    costingLineId: text("costing_line_id")
      .notNull()
      .references(() => costingLines.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    allocatedHours: real("allocated_hours").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.costingLineId, table.taskId] }),
    index("costing_allocations_task_idx").on(table.taskId),
  ],
);

export const clientActivities = sqliteTable(
  "client_activities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    activityName: text("activity_name").notNull(),
    startDate: text("start_date"),
    finishDate: text("finish_date"),
    percentComplete: real("percent_complete"),
    criticality: text("criticality").notNull().default("unknown"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("client_activity_source_idx").on(
      table.projectId,
      table.sourceRow,
    ),
  ],
);

export const programmeMappings = sqliteTable(
  "programme_mappings",
  {
    clientActivityId: text("client_activity_id")
      .notNull()
      .references(() => clientActivities.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    allocationPercent: real("allocation_percent").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.clientActivityId, table.taskId] }),
    index("programme_mappings_task_idx").on(table.taskId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    actorEmail: text("actor_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_project_created_idx").on(table.projectId, table.createdAt),
    index("audit_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    statusDate: text("status_date").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("snapshots_project_created_idx").on(table.projectId, table.createdAt)],
);
