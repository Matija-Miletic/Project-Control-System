import { env } from "cloudflare:workers";
import { loadControlState } from "../../../lib/control-state";
import { compareDates, subtractWorkingDays } from "../../../lib/date";

const PROJECT_ID = "DEMO-RETAIL-2026";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function actorFor(request: Request): string {
  const actor = request.headers.get(USER_EMAIL_HEADER);
  if (actor) return actor;
  const host = new URL(request.url).hostname;
  if (
    host === "terminal.local" ||
    host === "localhost" ||
    host === "127.0.0.1"
  ) {
    return "local-preview@savannah.invalid";
  }
  return "public-demo@savannah.invalid";
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).origin !== new URL(request.url).origin) {
    throw new RequestError("Cross-origin updates are not permitted.", 403);
  }
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("A JSON object is required.");
  }
  return value as Record<string, unknown>;
}

function textValue(
  payload: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number } = {},
): string {
  const raw = payload[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (options.required && !value) {
    throw new RequestError(`${key} is required.`);
  }
  if (value.length > (options.max ?? 500)) {
    throw new RequestError(`${key} is too long.`);
  }
  return value;
}

function nullableText(
  payload: Record<string, unknown>,
  key: string,
  max = 500,
): string | null {
  const value = textValue(payload, key, { max });
  return value || null;
}

function numberValue(
  payload: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; nullable?: boolean } = {},
): number | null {
  const raw = payload[key];
  if ((raw === null || raw === "" || raw === undefined) && options.nullable) {
    return null;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new RequestError(`${key} must be a number.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new RequestError(`${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new RequestError(`${key} must be no more than ${options.max}.`);
  }
  return value;
}

function dateValue(
  payload: Record<string, unknown>,
  key: string,
  nullable = false,
): string | null {
  const value = nullableText(payload, key, 10);
  if (!value && nullable) return null;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError(`${key} must be a valid date.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RequestError(`${key} must be a valid date.`);
  }
  return value;
}

function booleanValue(payload: Record<string, unknown>, key: string) {
  return payload[key] === true || payload[key] === "true";
}

function auditStatement(
  actor: string,
  entityType: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  return env.DB.prepare(
    `INSERT INTO audit_events
      (id, project_id, entity_type, entity_id, action, before_json,
       after_json, actor_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `AUD-${crypto.randomUUID()}`,
    PROJECT_ID,
    entityType,
    entityId,
    action,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    actor,
  );
}

function mutationError(error: unknown) {
  if (error instanceof RequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (
    message.includes("UNIQUE constraint failed") &&
    message.includes("dedupe")
  ) {
    return Response.json(
      {
        error:
          "That task, date, workfront and variation combination is already recorded. Edit the existing line or choose a different workfront.",
      },
      { status: 409 },
    );
  }
  if (message.includes("no such table")) {
    return Response.json(
      {
        error:
          "The project database is still being prepared. Reload in a moment.",
      },
      { status: 503 },
    );
  }
  console.error("Control API error", error);
  return Response.json(
    { error: "The update could not be saved. No controlled data was changed." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    actorFor(request);
    return Response.json(await loadControlState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mutationError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = actorFor(request);
    const body = objectPayload(await request.json());
    const action = textValue(body, "action", { required: true, max: 60 });
    const payload = objectPayload(body.payload);
    const state = await loadControlState();

    if (action === "add-daily-entry") {
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new RequestError("Select a valid task.");
      if (["cancelled", "on-hold"].includes(task.status)) {
        throw new RequestError(
          "This task is not active. Change its status before adding progress.",
        );
      }
      const date = dateValue(payload, "date")!;
      if (compareDates(date, state.project.statusDate) > 0) {
        throw new RequestError(
          "Daily entries cannot be later than the project status date.",
        );
      }
      const labourHours = numberValue(payload, "labourHours", {
        min: 0,
        max: 500,
      })!;
      const unitsCompleted = numberValue(payload, "unitsCompleted", {
        min: 0,
        max: 1_000_000,
      })!;
      const reworkHours = numberValue(payload, "reworkHours", {
        min: 0,
        max: labourHours,
      })!;
      if (labourHours === 0 && unitsCompleted === 0) {
        throw new RequestError("Enter labour hours, completed units, or both.");
      }
      const workfront =
        textValue(payload, "workfront", { max: 100 }) || task.workfront;
      const variationId = nullableText(payload, "variationId", 80);
      const variation = variationId
        ? state.variations.find((item) => item.id === variationId)
        : null;
      if (variationId && !variation) {
        throw new RequestError("Select a valid variation.");
      }
      const variationStatus = !variation
        ? "none"
        : variation.status === "approved"
          ? "approved"
          : variation.status === "rejected"
            ? "rejected"
            : "at-risk";
      const id = `DE-${crypto.randomUUID()}`;
      const dedupeKey = [
        PROJECT_ID,
        taskId,
        date,
        workfront,
        variationId ?? "base",
      ].join("|");
      const record = {
        id,
        taskId,
        date,
        workfront,
        labourHours,
        unitsCompleted,
        reworkHours,
        variationId,
        variationStatus,
        delayReason: nullableText(payload, "delayReason", 120),
        notes: textValue(payload, "notes", { max: 1000 }),
      };
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO daily_entries (
            id, project_id, task_id, date, workfront, labour_hours,
            units_completed, rework_hours, variation_id, variation_status,
            delay_reason, notes, dedupe_key, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          PROJECT_ID,
          taskId,
          date,
          workfront,
          labourHours,
          unitsCompleted,
          reworkHours,
          variationId,
          variationStatus,
          record.delayReason,
          record.notes,
          dedupeKey,
          actor,
        ),
        env.DB.prepare(
          `INSERT INTO audit_events
            (id, project_id, entity_type, entity_id, action, after_json,
             actor_email)
           VALUES (?, ?, 'daily-entry', ?, 'created', ?, ?)`,
        ).bind(
          `AUD-${crypto.randomUUID()}`,
          PROJECT_ID,
          id,
          JSON.stringify(record),
          actor,
        ),
      ]);
    } else if (action === "upsert-programme-day") {
      const taskId = nullableText(payload, "taskId", 80);
      if (taskId && !state.tasks.some((task) => task.id === taskId)) {
        throw new RequestError("Select a valid task.");
      }
      const date = dateValue(payload, "date")!;
      if (
        compareDates(date, state.programme.startDate) < 0 ||
        compareDates(date, state.programme.finishDate) > 0
      ) {
        throw new RequestError("Select a date within the project programme.");
      }
      const manDays = numberValue(payload, "manDays", {
        min: 0,
        max: 100,
      })!;
      const note = textValue(payload, "note", { max: 500 });
      const before = state.programmeDayValues.find(
        (value) => value.taskId === taskId && value.date === date,
      );
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO programme_day_values (
            project_id, task_id, date, man_days, note, created_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(project_id, task_id, date) DO UPDATE SET
            man_days = excluded.man_days,
            note = excluded.note,
            created_by = excluded.created_by,
            updated_at = CURRENT_TIMESTAMP`,
        ).bind(PROJECT_ID, taskId, date, manDays, note, actor),
        auditStatement(
          actor,
          "programme-day",
          `${taskId}|${date}`,
          before ? "updated" : "created",
          before ?? null,
          { taskId, date, manDays, note },
        ),
      ]);
    } else if (action === "delete-programme-day") {
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      const date = dateValue(payload, "date")!;
      const before = state.programmeDayValues.find(
        (value) => value.taskId === taskId && value.date === date,
      );
      if (!before) {
        throw new RequestError("That cell is already using its calculated value.");
      }
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM programme_day_values
           WHERE project_id = ? AND task_id = ? AND date = ?`,
        ).bind(PROJECT_ID, taskId, date),
        auditStatement(
          actor,
          "programme-day",
          `${taskId}|${date}`,
          "deleted",
          before,
          null,
        ),
      ]);
    } else if (action === "update-daily-entry") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const existing = state.entries.find((entry) => entry.id === id);
      if (!existing) throw new RequestError("Select a valid daily record.");
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new RequestError("Select a valid task.");
      const date = dateValue(payload, "date")!;
      if (compareDates(date, state.project.statusDate) > 0) {
        throw new RequestError(
          "Daily entries cannot be later than the project status date.",
        );
      }
      const labourHours = numberValue(payload, "labourHours", {
        min: 0,
        max: 500,
      })!;
      const unitsCompleted = numberValue(payload, "unitsCompleted", {
        min: 0,
        max: 1_000_000,
      })!;
      const reworkHours = numberValue(payload, "reworkHours", {
        min: 0,
        max: labourHours,
      })!;
      if (labourHours === 0 && unitsCompleted === 0) {
        throw new RequestError("Enter labour hours, completed units, or both.");
      }
      const workfront =
        textValue(payload, "workfront", { max: 100 }) || task.workfront;
      const variationId = nullableText(payload, "variationId", 80);
      const variation = variationId
        ? state.variations.find((item) => item.id === variationId)
        : null;
      if (variationId && !variation) {
        throw new RequestError("Select a valid variation.");
      }
      const variationStatus = !variation
        ? "none"
        : variation.status === "approved"
          ? "approved"
          : variation.status === "rejected"
            ? "rejected"
            : "at-risk";
      const after = {
        id,
        taskId,
        date,
        workfront,
        labourHours,
        unitsCompleted,
        reworkHours,
        variationId,
        variationStatus,
        delayReason: nullableText(payload, "delayReason", 120),
        notes: textValue(payload, "notes", { max: 1000 }),
      };
      const dedupeKey = [
        PROJECT_ID,
        taskId,
        date,
        workfront,
        variationId ?? "base",
      ].join("|");
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE daily_entries SET task_id = ?, date = ?, workfront = ?,
            labour_hours = ?, units_completed = ?, rework_hours = ?,
            variation_id = ?, variation_status = ?, delay_reason = ?,
            notes = ?, dedupe_key = ?
           WHERE id = ? AND project_id = ?`,
        ).bind(
          taskId,
          date,
          workfront,
          labourHours,
          unitsCompleted,
          reworkHours,
          variationId,
          variationStatus,
          after.delayReason,
          after.notes,
          dedupeKey,
          id,
          PROJECT_ID,
        ),
        auditStatement(actor, "daily-entry", id, "updated", existing, after),
      ]);
    } else if (action === "delete-daily-entry") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const existing = state.entries.find((entry) => entry.id === id);
      if (!existing) throw new RequestError("Select a valid daily record.");
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM daily_entries WHERE id = ? AND project_id = ?",
        ).bind(id, PROJECT_ID),
        auditStatement(actor, "daily-entry", id, "deleted", existing, null),
      ]);
    } else if (action === "update-forecast") {
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new RequestError("Select a valid task.");
      const manualRate = numberValue(payload, "manualForecastRate", {
        min: 0.0001,
        max: 100_000,
        nullable: true,
      });
      const manualStart = dateValue(payload, "manualForecastStart", true);
      const manualFinish = dateValue(payload, "manualForecastFinish", true);
      if (
        manualStart &&
        manualFinish &&
        compareDates(manualFinish, manualStart) < 0
      ) {
        throw new RequestError("Forecast finish cannot be before its start.");
      }
      const reason = textValue(payload, "reason", {
        required: Boolean(manualRate || manualStart || manualFinish),
        max: 500,
      });
      const before = {
        manualForecastRate: task.manualForecastRate,
        manualForecastStart: task.manualForecastStart,
        manualForecastFinish: task.manualForecastFinish,
      };
      const after = {
        manualForecastRate: manualRate,
        manualForecastStart: manualStart,
        manualForecastFinish: manualFinish,
        reason,
      };
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE tasks SET manual_forecast_rate = ?,
          manual_forecast_start = ?, manual_forecast_finish = ?,
          forecast_override_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND project_id = ?`,
        ).bind(
          manualRate,
          manualStart,
          manualFinish,
          reason || null,
          taskId,
          PROJECT_ID,
        ),
        auditStatement(
          actor,
          "task",
          taskId,
          "forecast-overridden",
          before,
          after,
        ),
      ]);
    } else if (action === "reset-forecasts") {
      const affectedTaskOverrides = state.tasks
        .filter(
          (task) =>
            task.manualForecastRate !== null ||
            task.manualForecastStart !== null ||
            task.manualForecastFinish !== null,
        )
        .map((task) => ({
          id: task.id,
          rate: task.manualForecastRate,
          start: task.manualForecastStart,
          finish: task.manualForecastFinish,
        }));
      const affectedDayValues = state.programmeDayValues.filter(
        (value) => compareDates(value.date, state.programme.today) > 0,
      );
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE tasks SET manual_forecast_rate = NULL,
          manual_forecast_start = NULL, manual_forecast_finish = NULL,
          forecast_override_reason = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND (
          manual_forecast_rate IS NOT NULL OR
          manual_forecast_start IS NOT NULL OR
          manual_forecast_finish IS NOT NULL
        )`,
        ).bind(PROJECT_ID),
        env.DB.prepare(
          `DELETE FROM programme_day_values
           WHERE project_id = ? AND date > ?`,
        ).bind(PROJECT_ID, state.programme.today),
        auditStatement(
          actor,
          "project",
          PROJECT_ID,
          "future-forecast-overrides-reset",
          {
            taskOverrides: affectedTaskOverrides,
            futureDayValues: affectedDayValues,
          },
          {
            clearedTaskOverrides: affectedTaskOverrides.length,
            clearedFutureDayValues: affectedDayValues.length,
            retained: ["baseline", "actuals", "approved changes"],
          },
        ),
      ]);
    } else if (action === "add-material") {
      const name = textValue(payload, "name", {
        required: true,
        max: 160,
      });
      const taskId = nullableText(payload, "taskId", 80);
      if (taskId && !state.tasks.some((task) => task.id === taskId)) {
        throw new RequestError("Select a valid task.");
      }
      const leadTime = numberValue(payload, "leadTimeWorkingDays", {
        min: 0,
        max: 520,
      })!;
      const buffer = numberValue(payload, "bufferWorkingDays", {
        min: 0,
        max: 60,
      })!;
      const targetNeedDate = dateValue(payload, "targetNeedDate", true);
      const suggestedOrderDate = targetNeedDate
        ? subtractWorkingDays(
            targetNeedDate,
            leadTime + buffer,
            new Set(state.holidayDates),
          )
        : null;
      const status =
        textValue(payload, "status", { max: 40 }) || "not-identified";
      const allowedStatuses = [
        "not-identified",
        "selection-required",
        "ready-to-order",
        "po-issued",
        "in-production",
        "in-transit",
        "delivered",
        "complete",
      ];
      if (!allowedStatuses.includes(status)) {
        throw new RequestError("Select a valid material status.");
      }
      const purchaseOrderNumber = nullableText(
        payload,
        "purchaseOrderNumber",
        100,
      );
      const purchaseOrderDate = dateValue(
        payload,
        "purchaseOrderDate",
        true,
      );
      if (
        ["po-issued", "in-production", "in-transit", "delivered", "complete"].includes(
          status,
        ) &&
        !purchaseOrderDate &&
        !purchaseOrderNumber
      ) {
        throw new RequestError(
          "Enter a purchase order number or purchase order date for this status.",
        );
      }
      const id = `MAT-${crypto.randomUUID()}`;
      const record = {
        id,
        name,
        taskId,
        leadTime,
        buffer,
        targetNeedDate,
        suggestedOrderDate,
        purchaseOrderNumber,
        purchaseOrderDate,
        status,
      };
      const statements = [
        env.DB.prepare(
          `INSERT INTO material_packages (
            id, project_id, name, component, supplier,
            lead_time_working_days, buffer_working_days, target_need_date,
            suggested_order_date, purchase_order_number, purchase_order_date,
            status, critical, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          PROJECT_ID,
          name,
          textValue(payload, "component", { max: 120 }) || "Package",
          textValue(payload, "supplier", { max: 160 }),
          leadTime,
          buffer,
          targetNeedDate ?? "",
          suggestedOrderDate ?? "",
          purchaseOrderNumber,
          purchaseOrderDate,
          status,
          booleanValue(payload, "critical") ? 1 : 0,
          textValue(payload, "notes", { max: 1000 }),
        ),
        env.DB.prepare(
          `INSERT INTO audit_events
            (id, project_id, entity_type, entity_id, action, after_json,
             actor_email)
           VALUES (?, ?, 'material', ?, 'created', ?, ?)`,
        ).bind(
          `AUD-${crypto.randomUUID()}`,
          PROJECT_ID,
          id,
          JSON.stringify(record),
          actor,
        ),
      ];
      if (taskId) {
        statements.splice(
          1,
          0,
          env.DB.prepare(
            "INSERT INTO material_tasks (material_id, task_id) VALUES (?, ?)",
          ).bind(id, taskId),
        );
      }
      await env.DB.batch(statements);
    } else if (action === "update-material") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const material = state.materials.find((item) => item.id === id);
      if (!material) throw new RequestError("Select a valid material package.");
      const name = textValue(payload, "name", {
        required: true,
        max: 160,
      });
      const taskId = nullableText(payload, "taskId", 80);
      if (taskId && !state.tasks.some((task) => task.id === taskId)) {
        throw new RequestError("Select a valid task.");
      }
      const leadTime = numberValue(payload, "leadTimeWorkingDays", {
        min: 0,
        max: 520,
      })!;
      const buffer = numberValue(payload, "bufferWorkingDays", {
        min: 0,
        max: 60,
      })!;
      const targetNeedDate = dateValue(payload, "targetNeedDate", true);
      const suggestedOrderDate = targetNeedDate
        ? subtractWorkingDays(
            targetNeedDate,
            leadTime + buffer,
            new Set(state.holidayDates),
          )
        : null;
      const allowedStatuses = [
        "not-identified",
        "selection-required",
        "ready-to-order",
        "po-issued",
        "in-production",
        "in-transit",
        "delivered",
        "complete",
      ];
      const status = textValue(payload, "status", {
        required: true,
        max: 40,
      });
      if (!allowedStatuses.includes(status)) {
        throw new RequestError("Select a valid material status.");
      }
      const purchaseOrderDate = dateValue(
        payload,
        "purchaseOrderDate",
        true,
      );
      const purchaseOrderNumber = nullableText(
        payload,
        "purchaseOrderNumber",
        100,
      );
      const confirmedDeliveryDate = dateValue(
        payload,
        "confirmedDeliveryDate",
        true,
      );
      if (
        ["po-issued", "in-production", "in-transit", "delivered", "complete"].includes(
          status,
        ) &&
        !purchaseOrderDate &&
        !purchaseOrderNumber
      ) {
        throw new RequestError(
          "Enter a purchase order number or purchase order date for this status.",
        );
      }
      const after = {
        id,
        name,
        taskId,
        component:
          textValue(payload, "component", { max: 120 }) || "Package",
        supplier: textValue(payload, "supplier", { max: 160 }),
        leadTimeWorkingDays: leadTime,
        bufferWorkingDays: buffer,
        targetNeedDate,
        suggestedOrderDate,
        purchaseOrderNumber,
        purchaseOrderDate,
        confirmedDeliveryDate,
        status,
        critical: booleanValue(payload, "critical"),
        notes: textValue(payload, "notes", { max: 1000 }),
      };
      const statements = [
        env.DB.prepare(
          `UPDATE material_packages SET name = ?, component = ?, supplier = ?,
          lead_time_working_days = ?, buffer_working_days = ?,
          target_need_date = ?, suggested_order_date = ?,
          purchase_order_number = ?, status = ?, purchase_order_date = ?,
          confirmed_delivery_date = ?, critical = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND project_id = ?`,
        ).bind(
          name,
          after.component,
          after.supplier,
          leadTime,
          buffer,
          targetNeedDate ?? "",
          suggestedOrderDate ?? "",
          purchaseOrderNumber,
          status,
          purchaseOrderDate,
          confirmedDeliveryDate,
          after.critical ? 1 : 0,
          after.notes,
          id,
          PROJECT_ID,
        ),
        env.DB.prepare(
          "DELETE FROM material_tasks WHERE material_id = ?",
        ).bind(id),
        auditStatement(actor, "material", id, "updated", material, after),
      ];
      if (taskId) {
        statements.splice(
          2,
          0,
          env.DB.prepare(
            "INSERT INTO material_tasks (material_id, task_id) VALUES (?, ?)",
          ).bind(id, taskId),
        );
      }
      await env.DB.batch(statements);
    } else if (action === "delete-material") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const material = state.materials.find((item) => item.id === id);
      if (!material) throw new RequestError("Select a valid material package.");
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM material_packages WHERE id = ? AND project_id = ?",
        ).bind(id, PROJECT_ID),
        auditStatement(actor, "material", id, "deleted", material, null),
      ]);
    } else if (action === "add-variation") {
      const title = textValue(payload, "title", {
        required: true,
        max: 180,
      });
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      if (!state.tasks.some((task) => task.id === taskId)) {
        throw new RequestError("Select a valid task.");
      }
      const submittedHours = numberValue(payload, "submittedHours", {
        min: 0,
        max: 100_000,
      })!;
      const exposureHours = numberValue(payload, "exposureHours", {
        min: 0,
        max: 100_000,
      })!;
      const id = `VO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const record = {
        id,
        title,
        taskId,
        submittedHours,
        exposureHours,
      };
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO variations (
            id, project_id, title, description, status, submitted_hours,
            approved_hours, exposure_hours, critical_path_impact,
            client_response_due
          ) VALUES (?, ?, ?, ?, 'potential', ?, 0, ?, ?, ?)`,
        ).bind(
          id,
          PROJECT_ID,
          title,
          textValue(payload, "description", { max: 1200 }),
          submittedHours,
          exposureHours,
          textValue(payload, "criticalPathImpact", { max: 20 }) || "unknown",
          dateValue(payload, "clientResponseDue", true),
        ),
        env.DB.prepare(
          `INSERT INTO variation_allocations (
            variation_id, task_id, submitted_hours, approved_hours,
            approved_units, exposure_hours
          ) VALUES (?, ?, ?, 0, 0, ?)`,
        ).bind(id, taskId, submittedHours, exposureHours),
        env.DB.prepare(
          `INSERT INTO audit_events
            (id, project_id, entity_type, entity_id, action, after_json,
             actor_email)
           VALUES (?, ?, 'variation', ?, 'created', ?, ?)`,
        ).bind(
          `AUD-${crypto.randomUUID()}`,
          PROJECT_ID,
          id,
          JSON.stringify(record),
          actor,
        ),
      ]);
    } else if (action === "update-variation") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const variation = state.variations.find((item) => item.id === id);
      if (!variation) throw new RequestError("Select a valid variation.");
      const title = textValue(payload, "title", {
        required: true,
        max: 180,
      });
      const status = textValue(payload, "status", {
        required: true,
        max: 40,
      });
      const allowedStatuses = [
        "potential",
        "pricing",
        "submitted",
        "instructed",
        "proceeding-at-risk",
        "approved",
        "partially-approved",
        "rejected",
        "complete",
        "claimed",
        "paid",
        "closed",
      ];
      if (!allowedStatuses.includes(status)) {
        throw new RequestError("Select a valid variation status.");
      }
      const taskId = textValue(payload, "taskId", {
        required: true,
        max: 80,
      });
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new RequestError("Select a valid task allocation.");
      const submittedHours = numberValue(payload, "submittedHours", {
        min: 0,
        max: 100_000,
      })!;
      const exposureHours = numberValue(payload, "exposureHours", {
        min: 0,
        max: 100_000,
      })!;
      const approvedHours = numberValue(payload, "approvedHours", {
        min: 0,
        max: submittedHours,
      })!;
      const approvedUnits = numberValue(payload, "approvedUnits", {
        min: 0,
        max: 1_000_000,
      })!;
      if (status === "approved" && approvedHours <= 0) {
        throw new RequestError("Approved variations require approved hours.");
      }
      const existing = await env.DB.prepare(
        `SELECT task_id AS taskId, approved_hours AS approvedHours,
          approved_units AS approvedUnits
         FROM variation_allocations WHERE variation_id = ?
         ORDER BY task_id LIMIT 1`,
      )
        .bind(id)
        .first<{
          taskId: string;
          approvedHours: number;
          approvedUnits: number;
        }>();
      const oldHours = existing?.approvedHours ?? 0;
      const oldUnits = existing?.approvedUnits ?? 0;
      const appliedHours =
        status === "approved" || status === "partially-approved"
          ? approvedHours
          : 0;
      const appliedUnits =
        status === "approved" || status === "partially-approved"
          ? approvedUnits
          : 0;
      const after = {
        id,
        title,
        description: textValue(payload, "description", { max: 1200 }),
        status,
        taskId,
        submittedHours,
        approvedHours: appliedHours,
        approvedUnits: appliedUnits,
        exposureHours:
          status === "approved" || status === "partially-approved"
            ? Math.max(0, submittedHours - appliedHours)
            : exposureHours,
        criticalPathImpact:
          textValue(payload, "criticalPathImpact", { max: 20 }) || "unknown",
        clientResponseDue: dateValue(payload, "clientResponseDue", true),
      };
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE variations SET title = ?, description = ?, status = ?,
            submitted_hours = ?, approved_hours = ?, exposure_hours = ?,
            critical_path_impact = ?, client_response_due = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(
          title,
          after.description,
          status,
          submittedHours,
          appliedHours,
          after.exposureHours,
          after.criticalPathImpact,
          after.clientResponseDue,
          id,
          PROJECT_ID,
        ),
        env.DB.prepare(
          "DELETE FROM variation_allocations WHERE variation_id = ?",
        ).bind(id),
        env.DB.prepare(
          `INSERT INTO variation_allocations (
            variation_id, task_id, submitted_hours, approved_hours,
            approved_units, exposure_hours
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          taskId,
          submittedHours,
          appliedHours,
          appliedUnits,
          after.exposureHours,
        ),
        env.DB.prepare(
          `UPDATE tasks SET
            approved_variation_hours = MAX(0, approved_variation_hours - ?),
            approved_variation_units = MAX(0, approved_variation_units - ?),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(
          oldHours,
          oldUnits,
          existing?.taskId ?? taskId,
          PROJECT_ID,
        ),
        env.DB.prepare(
          `UPDATE tasks SET
            approved_variation_hours = approved_variation_hours + ?,
            approved_variation_units = approved_variation_units + ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(
          appliedHours,
          appliedUnits,
          taskId,
          PROJECT_ID,
        ),
        auditStatement(actor, "variation", id, "updated", variation, after),
      ]);
    } else if (action === "delete-variation") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const variation = state.variations.find((item) => item.id === id);
      if (!variation) throw new RequestError("Select a valid variation.");
      const existing = await env.DB.prepare(
        `SELECT task_id AS taskId, approved_hours AS approvedHours,
          approved_units AS approvedUnits
         FROM variation_allocations WHERE variation_id = ?
         ORDER BY task_id LIMIT 1`,
      )
        .bind(id)
        .first<{
          taskId: string;
          approvedHours: number;
          approvedUnits: number;
        }>();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE tasks SET
            approved_variation_hours = MAX(0, approved_variation_hours - ?),
            approved_variation_units = MAX(0, approved_variation_units - ?),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(
          existing?.approvedHours ?? 0,
          existing?.approvedUnits ?? 0,
          existing?.taskId ?? "",
          PROJECT_ID,
        ),
        env.DB.prepare(
          "DELETE FROM variations WHERE id = ? AND project_id = ?",
        ).bind(id, PROJECT_ID),
        auditStatement(actor, "variation", id, "deleted", variation, null),
      ]);
    } else if (action === "update-project") {
      const statusDate = dateValue(payload, "statusDate")!;
      const targetFinish = dateValue(payload, "targetFinish")!;
      const productiveHours = numberValue(
        payload,
        "productiveHoursPerPerson",
        { min: 0.1, max: 24 },
      )!;
      const minimumPercent =
        numberValue(payload, "minimumProgressPercent", {
          min: 1,
          max: 100,
        })! / 100;
      const minimumUnits = numberValue(payload, "minimumProgressUnits", {
        min: 0.01,
        max: 100_000,
      })!;
      const nearCriticalDays = numberValue(payload, "nearCriticalDays", {
        min: 0,
        max: 90,
      })!;
      const after = {
        statusDate,
        targetFinish,
        productiveHoursPerPerson: productiveHours,
        minimumProgressPercent: minimumPercent,
        minimumProgressUnits: minimumUnits,
        nearCriticalDays,
      };
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE projects SET status_date = ?, target_finish = ?,
          productive_hours_per_person = ?, minimum_progress_percent = ?,
          minimum_progress_units = ?, near_critical_days = ?,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).bind(
          statusDate,
          targetFinish,
          productiveHours,
          minimumPercent,
          minimumUnits,
          nearCriticalDays,
          PROJECT_ID,
        ),
        auditStatement(
          actor,
          "project",
          PROJECT_ID,
          "control-settings-updated",
          state.project,
          after,
        ),
      ]);
    } else if (action === "add-calendar-exception") {
      const startDate = dateValue(payload, "startDate")!;
      const endDate = dateValue(payload, "endDate", true) ?? startDate;
      if (compareDates(endDate, startDate) < 0) {
        throw new RequestError("The end date cannot be before the start date.");
      }
      const name = textValue(payload, "name", {
        required: true,
        max: 100,
      });
      const id = `CAL-${crypto.randomUUID()}`;
      const after = {
        id,
        startDate,
        endDate,
        name,
        treatment: "non-working",
      };
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO calendar_exceptions (
            id, project_id, start_date, end_date, name, treatment
          ) VALUES (?, ?, ?, ?, ?, 'non-working')`,
        ).bind(id, PROJECT_ID, startDate, endDate, name),
        auditStatement(
          actor,
          "calendar-exception",
          id,
          "created",
          null,
          after,
        ),
      ]);
    } else if (action === "update-calendar-exception") {
      const id = textValue(payload, "id", { required: true, max: 100 });
      const existing = state.calendarExceptions.find(
        (exception) => exception.id === id,
      );
      if (!existing) {
        throw new RequestError("Select a valid calendar exception.");
      }
      const startDate = dateValue(payload, "startDate")!;
      const endDate = dateValue(payload, "endDate", true) ?? startDate;
      if (compareDates(endDate, startDate) < 0) {
        throw new RequestError("The end date cannot be before the start date.");
      }
      const name = textValue(payload, "name", {
        required: true,
        max: 100,
      });
      const after = {
        id,
        startDate,
        endDate,
        name,
        treatment: "non-working",
      };
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE calendar_exceptions SET start_date = ?, end_date = ?,
            name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(startDate, endDate, name, id, PROJECT_ID),
        auditStatement(
          actor,
          "calendar-exception",
          id,
          "updated",
          existing,
          after,
        ),
      ]);
    } else if (action === "delete-calendar-exception") {
      const id = textValue(payload, "id", { required: true, max: 100 });
      const existing = state.calendarExceptions.find(
        (exception) => exception.id === id,
      );
      if (!existing) {
        throw new RequestError("Select a valid calendar exception.");
      }
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM calendar_exceptions WHERE id = ? AND project_id = ?",
        ).bind(id, PROJECT_ID),
        auditStatement(
          actor,
          "calendar-exception",
          id,
          "deleted",
          existing,
          null,
        ),
      ]);
    } else if (action === "add-task") {
      const name = textValue(payload, "name", {
        required: true,
        max: 180,
      });
      const targetStart = dateValue(payload, "targetStart")!;
      const targetFinish = dateValue(payload, "targetFinish")!;
      if (compareDates(targetFinish, targetStart) < 0) {
        throw new RequestError("Task finish cannot be before its start.");
      }
      const originalUnits = numberValue(payload, "originalUnits", {
        min: 0.01,
        max: 10_000_000,
      })!;
      const originalBudgetHours = numberValue(
        payload,
        "originalBudgetHours",
        { min: 0.1, max: 1_000_000 },
      )!;
      const assignedStaff = numberValue(payload, "assignedStaff", {
        min: 0,
        max: 100,
      })!;
      const maxPracticalCrew = numberValue(payload, "maxPracticalCrew", {
        min: 0.1,
        max: 100,
        nullable: true,
      });
      const status =
        textValue(payload, "status", { max: 30 }) || "not-started";
      const criticality =
        textValue(payload, "criticality", { max: 30 }) || "unknown";
      const id = `TASK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const sort = state.tasks.length + 1;
      const after = {
        id,
        name,
        workPackage:
          textValue(payload, "workPackage", { max: 120 }) || "Additional scope",
        workfront:
          textValue(payload, "workfront", { max: 120 }) || "Whole project",
        trackingUom:
          textValue(payload, "trackingUom", {
            required: true,
            max: 40,
          }),
        originalUnits,
        originalBudgetHours,
        assignedStaff,
        maxPracticalCrew,
        targetStart,
        targetFinish,
        status,
        criticality,
        userCreated: true,
      };
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO tasks (
            id, project_id, name, work_package, workfront, tracking_uom,
            progress_method, original_units, approved_variation_units,
            original_budget_hours, approved_variation_hours, assigned_staff,
            max_practical_crew, target_start, target_finish, original_start,
            original_finish, criticality, criticality_source, status,
            access_date, user_created, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, 'continuous', ?, 0, ?, 0, ?, ?, ?, ?, ?,
            ?, ?, 'manual', ?, ?, 1, ?)`,
        ).bind(
          id,
          PROJECT_ID,
          name,
          after.workPackage,
          after.workfront,
          after.trackingUom,
          originalUnits,
          originalBudgetHours,
          assignedStaff,
          maxPracticalCrew,
          targetStart,
          targetFinish,
          targetStart,
          targetFinish,
          criticality,
          status,
          dateValue(payload, "accessDate", true),
          sort,
        ),
        auditStatement(actor, "task", id, "created", null, after),
      ]);
    } else if (action === "update-task") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const task = state.tasks.find((item) => item.id === id);
      if (!task) throw new RequestError("Select a valid task.");
      const targetStart = dateValue(payload, "targetStart")!;
      const targetFinish = dateValue(payload, "targetFinish")!;
      if (compareDates(targetFinish, targetStart) < 0) {
        throw new RequestError("Task finish cannot be before its start.");
      }
      const assignedStaff = numberValue(payload, "assignedStaff", {
        min: 0,
        max: 100,
      })!;
      const maxPracticalCrew = numberValue(payload, "maxPracticalCrew", {
        min: 0.1,
        max: 100,
        nullable: true,
      });
      const after = {
        ...task,
        name: task.userCreated
          ? textValue(payload, "name", { required: true, max: 180 })
          : task.name,
        workPackage: task.userCreated
          ? textValue(payload, "workPackage", { required: true, max: 120 })
          : task.workPackage,
        workfront: textValue(payload, "workfront", {
          required: true,
          max: 120,
        }),
        trackingUom: task.userCreated
          ? textValue(payload, "trackingUom", { required: true, max: 40 })
          : task.trackingUom,
        originalUnits: task.userCreated
          ? numberValue(payload, "originalUnits", {
              min: 0.01,
              max: 10_000_000,
            })!
          : task.originalUnits,
        originalBudgetHours: task.userCreated
          ? numberValue(payload, "originalBudgetHours", {
              min: 0.1,
              max: 1_000_000,
            })!
          : task.originalBudgetHours,
        assignedStaff,
        maxPracticalCrew,
        targetStart,
        targetFinish,
        status: textValue(payload, "status", { required: true, max: 30 }),
        criticality: textValue(payload, "criticality", {
          required: true,
          max: 30,
        }),
        accessDate: dateValue(payload, "accessDate", true),
      };
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE tasks SET name = ?, work_package = ?, workfront = ?,
            tracking_uom = ?, original_units = ?, original_budget_hours = ?,
            assigned_staff = ?, max_practical_crew = ?, target_start = ?,
            target_finish = ?, criticality = ?, criticality_source = 'manual',
            status = ?, access_date = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        ).bind(
          after.name,
          after.workPackage,
          after.workfront,
          after.trackingUom,
          after.originalUnits,
          after.originalBudgetHours,
          assignedStaff,
          maxPracticalCrew,
          targetStart,
          targetFinish,
          after.criticality,
          after.status,
          after.accessDate,
          id,
          PROJECT_ID,
        ),
        auditStatement(actor, "task", id, "updated", task, after),
      ]);
    } else if (action === "delete-task") {
      const id = textValue(payload, "id", { required: true, max: 80 });
      const task = state.tasks.find((item) => item.id === id);
      if (!task) throw new RequestError("Select a valid task.");
      if (!task.userCreated) {
        throw new RequestError(
          "Imported baseline tasks are protected. Cancel the task or create an approved variation instead.",
        );
      }
      const linked = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM daily_entries WHERE task_id = ?) +
          (SELECT COUNT(*) FROM material_tasks WHERE task_id = ?) +
          (SELECT COUNT(*) FROM variation_allocations WHERE task_id = ?) AS total`,
      )
        .bind(id, id, id)
        .first<{ total: number }>();
      if ((linked?.total ?? 0) > 0) {
        throw new RequestError(
          "Delete or reassign this task's daily, material and variation records first.",
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM tasks WHERE id = ? AND project_id = ?",
        ).bind(id, PROJECT_ID),
        auditStatement(actor, "task", id, "deleted", task, null),
      ]);
    } else if (action === "add-holiday") {
      const date = dateValue(payload, "date")!;
      const name = textValue(payload, "name", {
        required: true,
        max: 100,
      });
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO holidays (project_id, date, name) VALUES (?, ?, ?)
           ON CONFLICT(project_id, date) DO UPDATE SET name = excluded.name`,
        ).bind(PROJECT_ID, date, name),
        auditStatement(actor, "holiday", date, "upserted", null, {
          date,
          name,
        }),
      ]);
    } else {
      throw new RequestError("Unknown update action.");
    }

    return Response.json({ ok: true, state: await loadControlState() });
  } catch (error) {
    return mutationError(error);
  }
}
