import { env } from "cloudflare:workers";
import { loadControlState } from "../../../lib/control-state";

const USER_EMAIL_HEADER = "oai-authenticated-user-email";

function requireActor(request: Request) {
  const actor = request.headers.get(USER_EMAIL_HEADER);
  const host = new URL(request.url).hostname;
  if (
    actor ||
    host === "terminal.local" ||
    host === "localhost" ||
    host === "127.0.0.1"
  ) {
    return actor ?? "local-preview@savannah.invalid";
  }
  return "public-demo@savannah.invalid";
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  try {
    requireActor(request);
    const url = new URL(request.url);
    const state = await loadControlState();
    const date = state.programme.today;

    if (url.searchParams.get("format") === "csv") {
      const scope = url.searchParams.get("scope") ?? "daily";
      const taskNames = new Map(
        state.tasks.map((task) => [task.id, task.name]),
      );
      const sections: Record<string, unknown[][]> = {
        daily: [
          [
            "Entry ID",
            "Date",
            "Task ID",
            "Task",
            "Workfront",
            "Labour hours",
            "Physical quantity completed",
            "Physical unit",
            "Rework hours",
            "Variation",
            "Variation status",
            "Delay reason",
            "Notes",
          ],
          ...state.entries.map((entry) => [
            entry.id,
            entry.date,
            entry.taskId,
            taskNames.get(entry.taskId) ?? "",
            entry.workfront ?? "",
            entry.labourHours,
            entry.unitsCompleted,
            state.tasks.find((task) => task.id === entry.taskId)
              ?.trackingUom ?? "",
            entry.reworkHours,
            entry.variationId ?? "",
            entry.variationStatus,
            entry.delayReason ?? "",
            entry.notes ?? "",
          ]),
        ],
        programme: [
          [
            "Task ID",
            "Task",
            "Work package",
            "Target finish",
            "Revised man-days",
            "Remaining man-days",
            "Required man-days per working day",
            "Assigned crew",
            "Maximum practical crew",
            "Feasibility",
            "Date",
            "Man-days",
            "Value source",
          ],
          ...state.programme.rows.flatMap((row) =>
            row.cells.map((cell) => [
              row.taskId,
              row.taskName,
              row.workPackage,
              row.targetFinish,
              row.revisedManDays,
              row.remainingManDays,
              Number.isFinite(row.requiredManDaysPerWorkingDay)
                ? row.requiredManDaysPerWorkingDay
                : "Not achievable",
              row.assignedCrew,
              row.maxPracticalCrew ?? "",
              row.feasibility,
              cell.date,
              cell.manDays ?? "",
              cell.kind,
            ]),
          ),
        ],
        materials: [
          [
            "Package ID",
            "Package",
            "Task",
            "Component",
            "Supplier",
            "Need on site",
            "Lead time working days",
            "Buffer working days",
            "Suggested order date",
            "PO number",
            "PO date",
            "Confirmed delivery",
            "Status",
            "Critical",
            "Notes",
          ],
          ...state.materials.map((item) => [
            item.id,
            item.name,
            taskNames.get(item.taskIds[0]) ?? "",
            item.component ?? "",
            item.supplier ?? "",
            item.requiredOnSiteDate ?? "",
            item.leadTimeWorkingDays ?? 0,
            item.bufferWorkingDays ?? 0,
            item.suggestedOrderDate ?? "",
            item.purchaseOrderNumber ?? "",
            item.purchaseOrderDate ?? "",
            item.confirmedDeliveryDate ?? "",
            item.status,
            item.critical,
            item.notes ?? "",
          ]),
        ],
        variations: [
          [
            "Reference",
            "Title",
            "Task",
            "Status",
            "Submitted hours",
            "Approved hours",
            "Approved physical quantity",
            "Exposure hours",
            "Critical path impact",
            "Response due",
            "Description",
          ],
          ...state.variations.map((item) => [
            item.id,
            item.title,
            taskNames.get(item.taskId ?? "") ?? "",
            item.status,
            item.submittedHours,
            item.approvedHours,
            item.approvedUnits,
            item.exposureHours,
            item.criticalPathImpact,
            item.clientResponseDue ?? "",
            item.description ?? "",
          ]),
        ],
        tasks: [
          [
            "Task ID",
            "Task",
            "Work package",
            "Workfront",
            "Physical unit",
            "Total physical quantity",
            "Original budget hours",
            "Base man-days",
            "Assigned crew",
            "Maximum practical crew",
            "Target start",
            "Target finish",
            "Status",
            "Criticality",
            "Source",
          ],
          ...state.tasks.map((task) => [
            task.id,
            task.name,
            task.workPackage,
            task.workfront,
            task.trackingUom,
            task.originalUnits,
            task.originalBudgetHours,
            task.originalBudgetHours / state.project.productiveHoursPerPerson,
            task.assignedStaff,
            task.maxPracticalCrew ?? "",
            task.targetStart,
            task.targetFinish,
            task.status,
            task.criticality,
            task.userCreated ? "User added" : "Imported baseline",
          ]),
        ],
        quality: [
          ["Severity", "Area", "Title", "Detail"],
          ...state.checks.map((check) => [
            check.severity,
            check.area,
            check.title,
            check.detail,
          ]),
        ],
      };
      const selectedScopes =
        scope === "all"
          ? ["tasks", "daily", "programme", "materials", "variations", "quality"]
          : [scope];
      if (selectedScopes.some((item) => !sections[item])) {
        return Response.json({ error: "Unknown export scope." }, { status: 400 });
      }
      const rows = selectedScopes.flatMap((item, index) => [
        ...(index > 0 ? [[]] : []),
        [`SECTION: ${item.toUpperCase()}`],
        ...sections[item],
      ]);
      return new Response(
        rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="savannah-${scope}-${date}.csv"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const audits = await env.DB.prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId, action,
        before_json AS beforeJson, after_json AS afterJson,
        actor_email AS actorEmail, created_at AS createdAt
       FROM audit_events WHERE project_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
      .bind(state.project.id)
      .all();
    const snapshot = {
      format: "savannah-project-control",
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      state,
      auditEvents: audits.results,
    };
    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="savannah-project-backup-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Export error", error);
    return Response.json(
      { error: "The export could not be created." },
      { status: 500 },
    );
  }
}
