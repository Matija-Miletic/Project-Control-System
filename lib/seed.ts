import { env } from "cloudflare:workers";
import {
  pilotEntries,
  pilotHolidayDates,
  pilotMaterials,
  pilotProject,
  pilotTaskDependencies,
  pilotTasks,
  pilotVariations,
} from "./sample-data";

type BoundStatement = ReturnType<D1Database["prepare"]>;

async function runBatches(statements: BoundStatement[]) {
  const batchSize = 40;
  for (let index = 0; index < statements.length; index += batchSize) {
    await env.DB.batch(statements.slice(index, index + batchSize));
  }
}

/**
 * Idempotently installs the fictional public demonstration project. This runs
 * after schema migrations and also heals a partially interrupted first-run
 * seed. Every statement uses INSERT OR IGNORE so later demo changes are not
 * silently overwritten.
 */
export async function ensurePilotSeed() {
  if (!env.DB) {
    throw new Error("The project database binding is unavailable.");
  }

  const statements: BoundStatement[] = [];
  const prepare = (sql: string, ...values: unknown[]) =>
    env.DB.prepare(sql).bind(...values);

  statements.push(
    prepare(
      `INSERT OR IGNORE INTO projects (
        id, name, client, project_manager, site_manager, status_date,
        original_start, original_finish, target_finish, handover_date,
        productive_hours_per_person, minimum_progress_percent,
        minimum_progress_units, near_critical_days, display_mode, hourly_rate,
        source_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pilotProject.id,
      pilotProject.name,
      pilotProject.client,
      pilotProject.projectManager,
      pilotProject.siteManager,
      pilotProject.statusDate,
      pilotProject.originalStart,
      pilotProject.originalFinish,
      pilotProject.targetFinish,
      pilotProject.handoverDate,
      pilotProject.productiveHoursPerPerson,
      pilotProject.minimumProgressPercent,
      pilotProject.minimumProgressUnits,
      pilotProject.nearCriticalDays,
      pilotProject.displayMode,
      pilotProject.hourlyRate,
      "Fictional demonstration schedule and labour allowance. The summary finish is 16 Nov 2026; the 6 Nov 2026 handover milestone controls the demo. Baseline labour hours are protected and are not silently recalculated from a rate.",
    ),
  );

  for (const [sortOrder, task] of pilotTasks.entries()) {
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO tasks (
          id, project_id, name, work_package, workfront, tracking_uom,
          progress_method, original_units, approved_variation_units,
          original_budget_hours, approved_variation_hours, assigned_staff,
          max_practical_crew, target_start, target_finish, original_start,
          original_finish, criticality, criticality_source, status,
          manual_forecast_rate, manual_forecast_start, manual_forecast_finish,
          access_date, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        pilotProject.id,
        task.name,
        task.workPackage,
        task.workfront,
        task.trackingUom,
        task.progressMethod,
        task.originalUnits,
        task.approvedVariationUnits,
        task.originalBudgetHours,
        task.approvedVariationHours,
        task.assignedStaff,
        task.maxPracticalCrew,
        task.targetStart,
        task.targetFinish,
        task.originalStart,
        task.originalFinish,
        task.criticality,
        task.criticalitySource,
        task.status,
        task.manualForecastRate,
        task.manualForecastStart,
        task.manualForecastFinish,
        task.accessDate,
        sortOrder + 1,
      ),
    );

    statements.push(
      prepare(
        `INSERT OR IGNORE INTO costing_lines (
          id, project_id, source_sheet, source_row, source_reference,
          description, work_section, package_name, original_labour_value,
          imported_budget_hours, import_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `CL-${String(sortOrder + 1).padStart(3, "0")}`,
        pilotProject.id,
        "Allowances work-section roll-up",
        sortOrder + 1,
        task.id,
        task.name,
        task.name,
        task.workPackage,
        task.originalBudgetHours * 60,
        task.originalBudgetHours,
        60,
      ),
    );
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO costing_allocations
          (costing_line_id, task_id, allocated_hours) VALUES (?, ?, ?)`,
        `CL-${String(sortOrder + 1).padStart(3, "0")}`,
        task.id,
        task.originalBudgetHours,
      ),
    );
  }

  for (const [taskId, predecessorTaskId] of pilotTaskDependencies) {
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO task_dependencies (
          project_id, task_id, predecessor_task_id, dependency_type,
          lag_working_days
        ) VALUES (?, ?, ?, 'FS', 0)`,
        pilotProject.id,
        taskId,
        predecessorTaskId,
      ),
    );
  }

  for (const variation of pilotVariations) {
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO variations (
          id, project_id, title, status, submitted_hours, approved_hours,
          exposure_hours, critical_path_impact, client_response_due
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        variation.id,
        pilotProject.id,
        variation.title,
        variation.status,
        variation.submittedHours,
        variation.approvedHours,
        variation.exposureHours,
        variation.criticalPathImpact,
        variation.clientResponseDue,
      ),
    );
  }

  for (const entry of pilotEntries) {
    const workfront =
      pilotTasks.find((task) => task.id === entry.taskId)?.workfront ??
      "Whole project";
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO daily_entries (
          id, project_id, task_id, date, workfront, labour_hours,
          units_completed, rework_hours, variation_id, variation_status,
          delay_reason, notes, dedupe_key, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        pilotProject.id,
        entry.taskId,
        entry.date,
        workfront,
        entry.labourHours,
        entry.unitsCompleted,
        entry.reworkHours,
        entry.variationId ?? null,
        entry.variationStatus,
        entry.delayReason,
        "",
        [
          pilotProject.id,
          entry.taskId,
          entry.date,
          workfront,
          entry.variationId ?? "base",
        ].join("|"),
        "demo-seed@savannah.invalid",
      ),
    );
  }

  for (const material of pilotMaterials) {
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO material_packages (
          id, project_id, name, component, supplier, lead_time_working_days,
          buffer_working_days, target_need_date, forecast_need_date,
          manual_need_date, suggested_order_date, purchase_order_number,
          purchase_order_date, confirmed_delivery_date, status, critical, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        material.id,
        pilotProject.id,
        material.name,
        material.component ?? "Package",
        material.supplier ?? "",
        material.leadTimeWorkingDays ?? 0,
        material.bufferWorkingDays ?? 0,
        material.requiredOnSiteDate ?? "",
        material.forecastNeedDate ?? null,
        material.manualNeedDate ?? null,
        material.suggestedOrderDate ?? "",
        material.purchaseOrderNumber ?? null,
        material.purchaseOrderDate,
        material.confirmedDeliveryDate,
        material.status,
        material.critical ? 1 : 0,
        material.notes ?? "",
      ),
    );
    for (const taskId of material.taskIds) {
      statements.push(
        prepare(
          `INSERT OR IGNORE INTO material_tasks
            (material_id, task_id) VALUES (?, ?)`,
          material.id,
          taskId,
        ),
      );
    }
  }

  for (const holiday of pilotHolidayDates) {
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO holidays (project_id, date, name)
          VALUES (?, ?, ?)`,
        pilotProject.id,
        holiday,
        holiday === "2026-07-10" ? "Matariki" : "Labour Day",
      ),
    );
    statements.push(
      prepare(
        `INSERT OR IGNORE INTO calendar_exceptions (
          id, project_id, start_date, end_date, name, treatment
        ) VALUES (?, ?, ?, ?, ?, 'non-working')`,
        `CAL-${holiday}`,
        pilotProject.id,
        holiday,
        holiday,
        holiday === "2026-07-10" ? "Matariki" : "Labour Day",
      ),
    );
  }

  statements.push(
    prepare(
      `INSERT OR IGNORE INTO audit_events (
        id, project_id, entity_type, entity_id, action, after_json, actor_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "AUDIT-DEMO-SEED",
      pilotProject.id,
      "project",
      pilotProject.id,
      "demo-seeded",
      JSON.stringify({
        sources: [
          "Fictional demonstration allowance",
          "Fictional demonstration programme",
        ],
        originalBudgetHours: 1825.9,
      }),
      "demo-seed@savannah.invalid",
    ),
  );

  await runBatches(statements);
}
