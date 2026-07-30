"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import type {
  ControlCheck,
  ControlState,
  MaterialPackage,
  Variation,
} from "../../lib/types";
import { StatusPill } from "./status-pill";
import { HelpTip } from "./help-tip";
import { CollapsibleRegister, ItemModal } from "./item-modal";
import { PageExports } from "./page-exports";
import { ProgrammeBoard } from "./programme-board";

type Section =
  | "daily"
  | "programme"
  | "materials"
  | "variations"
  | "quality"
  | "help"
  | "setup";

type MutationResult = { ok: true; state: ControlState };

const materialStatuses: MaterialPackage["status"][] = [
  "not-identified",
  "selection-required",
  "ready-to-order",
  "po-issued",
  "in-production",
  "in-transit",
  "delivered",
  "complete",
];

const variationStatuses: Variation["status"][] = [
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

function humanise(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) =>
    letter.toUpperCase(),
  );
}

function hours(value: number) {
  return `${value.toLocaleString("en-NZ", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} h`;
}

function nzDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function Field({
  label,
  help,
  helpTopic,
  children,
}: {
  label: string;
  help?: string;
  helpTopic?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {help ? (
          <HelpTip topic={helpTopic ?? "field-help"} summary={help} />
        ) : null}
      </span>
      {children}
      {help ? <small>{help}</small> : null}
    </label>
  );
}

function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="button primary" type="submit" disabled={busy}>
      {busy ? "Saving…" : children}
    </button>
  );
}

function Feedback({
  message,
  error,
}: {
  message: string;
  error: string;
}) {
  if (!message && !error) return null;
  return (
    <div
      className={`inline-feedback ${error ? "error" : "success"}`}
      role="status"
      aria-live="polite"
    >
      {error || message}
    </div>
  );
}

export function ControlWorkspace({ section }: { section: Section }) {
  const [state, setState] = useState<ControlState | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadingError("");
    try {
      const response = await fetch("/api/control", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as ControlState & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load project.");
      setState(data);
    } catch (loadError) {
      setLoadingError(
        loadError instanceof Error ? loadError.message : "Unable to load project.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mutate = useCallback(
    async (action: string, payload: Record<string, unknown>, success: string) => {
      setBusy(true);
      setMessage("");
      setError("");
      try {
        const response = await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action, payload }),
        });
        const data = (await response.json()) as
          | MutationResult
          | { error: string };
        if (!response.ok || !("state" in data)) {
          throw new Error("error" in data ? data.error : "The update was not saved.");
        }
        setState(data.state);
        setMessage(success);
        return true;
      } catch (mutationError) {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : "The update was not saved.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (loadingError) {
    return (
      <section className="panel empty-state">
        <span className="eyebrow">Database unavailable</span>
        <h2>The controlled project data could not be loaded</h2>
        <p>{loadingError}</p>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="panel loading-state" aria-busy="true">
        <span className="loading-dot" />
        Preparing the project controls…
      </section>
    );
  }

  const shared = { state, busy, message, error, mutate };
  return (
    <>
      <Feedback message={message} error={error} />
      {section === "daily" ? <DailyWorkspace {...shared} /> : null}
      {section === "programme" ? <ProgrammeWorkspace {...shared} /> : null}
      {section === "materials" ? <MaterialsWorkspace {...shared} /> : null}
      {section === "variations" ? <VariationsWorkspace {...shared} /> : null}
      {section === "quality" ? <QualityWorkspace state={state} /> : null}
      {section === "help" ? <HelpWorkspace state={state} /> : null}
      {section === "setup" ? <SetupWorkspace {...shared} /> : null}
    </>
  );
}

type WorkspaceProps = {
  state: ControlState;
  busy: boolean;
  message: string;
  error: string;
  mutate: (
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) => Promise<boolean>;
};

function DailyWorkspace({ state, busy, mutate }: WorkspaceProps) {
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<
    ControlState["entries"][number] | null
  >(null);
  const activeTasks = state.tasks.filter(
    (task) => !["cancelled", "on-hold"].includes(task.status),
  );
  const taskNames = new Map(state.tasks.map((task) => [task.id, task.name]));
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const saved = await mutate(
      "add-daily-entry",
      {
        ...values,
        labourHours: Number(values.labourHours),
        unitsCompleted: Number(values.unitsCompleted),
        reworkHours: Number(values.reworkHours || 0),
      },
      "Daily labour and progress saved. Forecasts and checks have been recalculated.",
    );
    if (saved) form.reset();
  };
  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const saved = await mutate(
      "update-daily-entry",
      {
        ...values,
        labourHours: Number(values.labourHours),
        unitsCompleted: Number(values.unitsCompleted),
        reworkHours: Number(values.reworkHours || 0),
      },
      "Daily record updated.",
    );
    if (saved) setSelectedEntry(null);
  };
  const remove = async () => {
    if (
      !selectedEntry ||
      !window.confirm(
        `Delete the ${nzDate(selectedEntry.date)} record? This cannot be undone.`,
      )
    ) {
      return;
    }
    const deleted = await mutate(
      "delete-daily-entry",
      { id: selectedEntry.id },
      "Daily record deleted and forecasts recalculated.",
    );
    if (deleted) setSelectedEntry(null);
  };

  return (
    <>
      <div className="workspace-grid">
        <section className="panel form-panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Today&apos;s record</span>
            <h2>Add labour and physical progress</h2>
          </div>
          <StatusPill status="neutral">
            Status {nzDate(state.project.statusDate)}
          </StatusPill>
        </div>
        <PageExports scope="daily" />
        <p className="section-copy">
          Enter what happened today—not a cumulative total. At-risk variation
          work is separated from approved productivity automatically.
        </p>
        <form className="control-form" onSubmit={onSubmit}>
          <div className="form-grid two">
            <Field label="Date">
              <input
                name="date"
                type="date"
                required
                max={state.project.statusDate}
                defaultValue={state.project.statusDate}
              />
            </Field>
            <Field
              label="Savannah task"
              help="The selected task defines what the physical quantity field measures."
              helpTopic="daily-quantity"
            >
              <select
                name="taskId"
                required
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                <option value="" disabled>
                  Select task
                </option>
                {activeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name} · {task.trackingUom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workfront" help="Use a distinct area when parallel crews work the same task.">
              <input name="workfront" placeholder="Defaults to the task workfront" />
            </Field>
            <Field label="Variation">
              <select name="variationId" defaultValue="">
                <option value="">Approved base scope</option>
                {state.variations
                  .filter((variation) => !["closed", "paid"].includes(variation.status))
                  .map((variation) => (
                    <option key={variation.id} value={variation.id}>
                      {variation.id} · {variation.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Total labour hours">
              <input
                name="labourHours"
                type="number"
                required
                min="0"
                max="500"
                step="0.1"
                inputMode="decimal"
              />
            </Field>
            <Field
              label={`Physical quantity completed today${
                selectedTask ? ` (${selectedTask.trackingUom})` : ""
              }`}
              help={
                selectedTask
                  ? `Enter today's completed ${selectedTask.trackingUom}, not a cumulative total.`
                  : "Select a task first; its unit of measure will be shown here."
              }
              helpTopic="daily-quantity"
            >
              <input
                name="unitsCompleted"
                type="number"
                required
                min="0"
                step="0.01"
                inputMode="decimal"
              />
            </Field>
            <Field label="Rework hours" help="Included in total labour hours.">
              <input
                name="reworkHours"
                type="number"
                min="0"
                step="0.1"
                defaultValue="0"
                inputMode="decimal"
              />
            </Field>
            <Field label="Delay reason">
              <select name="delayReason" defaultValue="">
                <option value="">No delay</option>
                <option>Access or plant unavailable</option>
                <option>Material unavailable</option>
                <option>Design information unavailable</option>
                <option>Client change</option>
                <option>Predecessor incomplete</option>
                <option>Weather</option>
                <option>Quality or rework</option>
                <option>Labour unavailable</option>
              </select>
            </Field>
          </div>
          <Field label="Site note">
            <textarea
              name="notes"
              rows={3}
              maxLength={1000}
              placeholder="Optional context that will help tomorrow's review"
            />
          </Field>
          <div className="form-actions">
            <SubmitButton busy={busy}>Save daily record</SubmitButton>
            <span>Duplicate task/date/workfront lines are blocked.</span>
          </div>
        </form>
        </section>

        <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Recent history</span>
            <h2>Last 12 entries</h2>
          </div>
          <span>Click a full-register row below to edit or delete it.</span>
        </div>
        <div className="responsive-table compact-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Task</th>
                <th>Hours</th>
                <th>Progress</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.slice(0, 12).map((entry) => (
                <tr key={entry.id}>
                  <td>{nzDate(entry.date)}</td>
                  <td>
                    <strong>{taskNames.get(entry.taskId)}</strong>
                    {entry.delayReason ? <small>{entry.delayReason}</small> : null}
                  </td>
                  <td>{hours(entry.labourHours)}</td>
                  <td>{entry.unitsCompleted.toLocaleString("en-NZ")}</td>
                  <td>
                    <StatusPill
                      status={entry.variationStatus === "at-risk" ? "watch" : "neutral"}
                    >
                      {entry.variationStatus === "none"
                        ? "Base"
                        : humanise(entry.variationStatus)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>
      </div>

      <section className="panel register-panel">
        <CollapsibleRegister
          title="All daily records"
          count={state.entries.length}
        >
          <div className="responsive-table compact-table">
            <table className="clickable-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Task</th>
                  <th>Labour hours</th>
                  <th>Physical quantity</th>
                  <th>Workfront</th>
                  <th>Delay reason</th>
                </tr>
              </thead>
              <tbody>
                {state.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    tabIndex={0}
                    onClick={() => setSelectedEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelectedEntry(entry);
                    }}
                  >
                    <td>{nzDate(entry.date)}</td>
                    <td>{taskNames.get(entry.taskId)}</td>
                    <td>{hours(entry.labourHours)}</td>
                    <td>
                      {entry.unitsCompleted.toLocaleString("en-NZ")}{" "}
                      {state.tasks.find((task) => task.id === entry.taskId)
                        ?.trackingUom ?? ""}
                    </td>
                    <td>{entry.workfront ?? "Whole project"}</td>
                    <td>{entry.delayReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleRegister>
      </section>

      <ItemModal
        open={Boolean(selectedEntry)}
        title="Edit daily record"
        onClose={() => setSelectedEntry(null)}
      >
        {selectedEntry ? (
          <form className="control-form modal-form" onSubmit={onUpdate}>
            <input type="hidden" name="id" value={selectedEntry.id} />
            <div className="form-grid two">
              <Field label="Date">
                <input
                  name="date"
                  type="date"
                  required
                  max={state.project.statusDate}
                  defaultValue={selectedEntry.date}
                />
              </Field>
              <Field label="Savannah task">
                <select name="taskId" required defaultValue={selectedEntry.taskId}>
                  {activeTasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Workfront">
                <input name="workfront" defaultValue={selectedEntry.workfront ?? ""} />
              </Field>
              <Field label="Variation">
                <select name="variationId" defaultValue={selectedEntry.variationId ?? ""}>
                  <option value="">Approved base scope</option>
                  {state.variations.map((variation) => (
                    <option key={variation.id} value={variation.id}>
                      {variation.id} · {variation.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Total labour hours">
                <input name="labourHours" type="number" min="0" max="500" step="0.1" required defaultValue={selectedEntry.labourHours} />
              </Field>
              <Field label="Physical quantity completed">
                <input name="unitsCompleted" type="number" min="0" step="0.01" required defaultValue={selectedEntry.unitsCompleted} />
              </Field>
              <Field label="Rework hours">
                <input name="reworkHours" type="number" min="0" step="0.1" defaultValue={selectedEntry.reworkHours} />
              </Field>
              <Field label="Delay reason">
                <input name="delayReason" defaultValue={selectedEntry.delayReason ?? ""} />
              </Field>
            </div>
            <Field label="Site note">
              <textarea name="notes" rows={3} defaultValue={selectedEntry.notes ?? ""} />
            </Field>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={() => void remove()}>
                Delete
              </button>
              <span className="modal-actions-right">
                <button className="button quiet" type="button" onClick={() => setSelectedEntry(null)}>
                  Cancel
                </button>
                <SubmitButton busy={busy}>Save changes</SubmitButton>
              </span>
            </div>
          </form>
        ) : null}
      </ItemModal>
    </>
  );
}

function ProgrammeWorkspace({ state, busy, mutate }: WorkspaceProps) {
  return <ProgrammeBoard state={state} busy={busy} mutate={mutate} />;
}

function MaterialsWorkspace({ state, busy, mutate }: WorkspaceProps) {
  const [selectedMaterial, setSelectedMaterial] = useState<
    ControlState["materials"][number] | null
  >(null);
  const onAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const saved = await mutate(
      "add-material",
      {
        ...values,
        leadTimeWorkingDays: Number(values.leadTimeWorkingDays),
        bufferWorkingDays: Number(values.bufferWorkingDays),
        critical: new FormData(form).get("critical") === "on",
      },
      "Material package added and its working-day order date calculated.",
    );
    if (saved) form.reset();
  };
  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const saved = await mutate(
      "update-material",
      {
        ...values,
        leadTimeWorkingDays: Number(values.leadTimeWorkingDays),
        bufferWorkingDays: Number(values.bufferWorkingDays),
        critical: new FormData(form).get("critical") === "on",
      },
      "Material package updated and order timing recalculated.",
    );
    if (saved) setSelectedMaterial(null);
  };
  const remove = async () => {
    if (
      !selectedMaterial ||
      !window.confirm(
        `Delete “${selectedMaterial.name}”? This cannot be undone.`,
      )
    ) {
      return;
    }
    const deleted = await mutate(
      "delete-material",
      { id: selectedMaterial.id },
      "Material package deleted.",
    );
    if (deleted) setSelectedMaterial(null);
  };
  const taskNames = new Map(state.tasks.map((task) => [task.id, task.name]));
  const overdue = state.materials.filter(
    (material) =>
      !material.purchaseOrderDate &&
      !material.purchaseOrderNumber &&
      material.suggestedOrderDate &&
      material.suggestedOrderDate <= state.project.statusDate,
  ).length;

  return (
    <>
      <div className="workspace-grid">
        <section className="panel form-panel">
          <div className="card-heading">
            <div>
              <span className="eyebrow">New package</span>
              <h2>
                Add a procurement control
                <HelpTip
                  topic="materials"
                  summary="Create a material package and calculate its working-day order deadline."
                />
              </h2>
            </div>
            <PageExports scope="materials" />
          </div>
          <p className="section-copy">
            Lead time and buffer use the project calendar. Supplier confirmation
            remains visible separately from the calculated order date.
          </p>
          <form className="control-form" onSubmit={onAdd}>
            <Field label="Package name">
              <input name="name" required maxLength={160} />
            </Field>
            <div className="form-grid two">
              <Field label="Linked task">
                <select name="taskId" defaultValue="">
                  <option value="">Unallocated — complete later</option>
                  {state.tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Component">
                <input name="component" placeholder="Package" maxLength={120} />
              </Field>
              <Field label="Supplier">
                <input name="supplier" placeholder="To be confirmed" maxLength={160} />
              </Field>
              <Field label="Target need date">
                <input name="targetNeedDate" type="date" />
              </Field>
              <Field
                label="Lead time (working days)"
                help="Supplier lead time counted on project working days."
                helpTopic="materials"
              >
                <input name="leadTimeWorkingDays" type="number" min="0" max="520" required />
              </Field>
              <Field
                label="Buffer (working days)"
                help="Additional protection before the target need date."
                helpTopic="materials"
              >
                <input name="bufferWorkingDays" type="number" min="0" max="60" defaultValue="5" required />
              </Field>
              <Field label="Status">
                <select name="status" defaultValue="not-identified">
                  {materialStatuses.map((status) => (
                    <option key={status} value={status}>{humanise(status)}</option>
                  ))}
                </select>
              </Field>
              <Field label="PO number">
                <input name="purchaseOrderNumber" maxLength={100} />
              </Field>
              <Field label="PO date">
                <input name="purchaseOrderDate" type="date" />
              </Field>
            </div>
            <label className="check-field">
              <input name="critical" type="checkbox" />
              <span>Late delivery could constrain a critical or near-critical task</span>
            </label>
            <Field label="Notes">
              <textarea name="notes" rows={3} maxLength={1000} />
            </Field>
            <SubmitButton busy={busy}>Add material package</SubmitButton>
          </form>
        </section>

        <section className="panel register-summary">
          <span className="eyebrow">Procurement position</span>
          <h2>{state.materials.length} controlled packages</h2>
          <div className="summary-stat-grid">
            <div><span>Order date passed</span><strong>{overdue}</strong></div>
            <div>
              <span>Ordered</span>
              <strong>{state.materials.filter((item) => item.purchaseOrderDate || item.purchaseOrderNumber).length}</strong>
            </div>
            <div>
              <span>Delivered / complete</span>
              <strong>{state.materials.filter((item) => ["delivered", "complete"].includes(item.status)).length}</strong>
            </div>
          </div>
          <p className="form-note">
            The register below stays collapsed during routine entry. Open it to
            inspect, edit or delete any package.
          </p>
        </section>
      </div>

      <section className="panel register-panel">
        <CollapsibleRegister
          title="Material package register"
          count={state.materials.length}
        >
          <div className="responsive-table">
            <table className="clickable-table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Linked task</th>
                  <th>Supplier</th>
                  <th>Need on site</th>
                  <th>Order by</th>
                  <th>PO</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.materials.map((material) => (
                  <tr
                    key={material.id}
                    tabIndex={0}
                    onClick={() => setSelectedMaterial(material)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelectedMaterial(material);
                    }}
                  >
                    <td><strong>{material.name}</strong><small>{material.component}</small></td>
                    <td>{taskNames.get(material.taskIds[0]) ?? "Unlinked"}</td>
                    <td>{material.supplier || "TBC"}</td>
                    <td>{nzDate(material.requiredOnSiteDate)}</td>
                    <td>{nzDate(material.suggestedOrderDate)}</td>
                    <td>{material.purchaseOrderNumber || nzDate(material.purchaseOrderDate)}</td>
                    <td>
                      <StatusPill
                        status={
                          !material.purchaseOrderDate &&
                          !material.purchaseOrderNumber &&
                          material.suggestedOrderDate &&
                          material.suggestedOrderDate <= state.project.statusDate
                            ? "risk"
                            : ["delivered", "complete"].includes(material.status)
                              ? "good"
                              : "watch"
                        }
                      >
                        {humanise(material.status)}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleRegister>
      </section>

      <ItemModal
        open={Boolean(selectedMaterial)}
        title="Edit material package"
        onClose={() => setSelectedMaterial(null)}
      >
        {selectedMaterial ? (
          <form className="control-form modal-form" onSubmit={onUpdate}>
            <input type="hidden" name="id" value={selectedMaterial.id} />
            <Field label="Package name">
              <input name="name" required defaultValue={selectedMaterial.name} />
            </Field>
            <div className="form-grid two">
              <Field label="Linked task">
                <select name="taskId" defaultValue={selectedMaterial.taskIds[0] ?? ""}>
                  <option value="">Unallocated — complete later</option>
                  {state.tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Component">
                <input name="component" defaultValue={selectedMaterial.component ?? "Package"} />
              </Field>
              <Field label="Supplier">
                <input name="supplier" defaultValue={selectedMaterial.supplier ?? ""} />
              </Field>
              <Field label="Target need date">
                <input name="targetNeedDate" type="date" defaultValue={selectedMaterial.requiredOnSiteDate ?? ""} />
              </Field>
              <Field label="Lead time (working days)">
                <input name="leadTimeWorkingDays" type="number" min="0" max="520" required defaultValue={selectedMaterial.leadTimeWorkingDays ?? 0} />
              </Field>
              <Field label="Buffer (working days)">
                <input name="bufferWorkingDays" type="number" min="0" max="60" required defaultValue={selectedMaterial.bufferWorkingDays ?? 0} />
              </Field>
              <Field label="Status">
                <select name="status" defaultValue={selectedMaterial.status}>
                  {materialStatuses.map((status) => (
                    <option key={status} value={status}>{humanise(status)}</option>
                  ))}
                </select>
              </Field>
              <Field label="PO date">
                <input name="purchaseOrderDate" type="date" defaultValue={selectedMaterial.purchaseOrderDate ?? ""} />
              </Field>
              <Field label="PO number">
                <input name="purchaseOrderNumber" defaultValue={selectedMaterial.purchaseOrderNumber ?? ""} />
              </Field>
              <Field label="Confirmed delivery">
                <input name="confirmedDeliveryDate" type="date" defaultValue={selectedMaterial.confirmedDeliveryDate ?? ""} />
              </Field>
            </div>
            <label className="check-field">
              <input name="critical" type="checkbox" defaultChecked={selectedMaterial.critical} />
              <span>Critical or near-critical constraint</span>
            </label>
            <Field label="Notes">
              <textarea name="notes" rows={3} defaultValue={selectedMaterial.notes ?? ""} />
            </Field>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={() => void remove()}>
                Delete
              </button>
              <span className="modal-actions-right">
                <button className="button quiet" type="button" onClick={() => setSelectedMaterial(null)}>Cancel</button>
                <SubmitButton busy={busy}>Save changes</SubmitButton>
              </span>
            </div>
          </form>
        ) : null}
      </ItemModal>
    </>
  );
}

function VariationsWorkspace({ state, busy, mutate }: WorkspaceProps) {
  const [selectedVariation, setSelectedVariation] = useState<
    ControlState["variations"][number] | null
  >(null);
  const onAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const saved = await mutate(
      "add-variation",
      {
        ...values,
        submittedHours: Number(values.submittedHours),
        exposureHours: Number(values.exposureHours),
      },
      "Variation added. Exposure remains outside the approved budget until authorised.",
    );
    if (saved) form.reset();
  };
  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const saved = await mutate(
      "update-variation",
      {
        ...values,
        submittedHours: Number(values.submittedHours),
        exposureHours: Number(values.exposureHours),
        approvedHours: Number(values.approvedHours),
        approvedUnits: Number(values.approvedUnits),
      },
      "Variation updated and the approved task budget reconciled.",
    );
    if (saved) setSelectedVariation(null);
  };
  const remove = async () => {
    if (
      !selectedVariation ||
      !window.confirm(
        `Delete ${selectedVariation.id} “${selectedVariation.title}”? Any approved allocation will be removed from the task budget.`,
      )
    ) {
      return;
    }
    const deleted = await mutate(
      "delete-variation",
      { id: selectedVariation.id },
      "Variation deleted and approved allocations reversed.",
    );
    if (deleted) setSelectedVariation(null);
  };

  const openExposure = state.variations.reduce(
    (total, variation) => total + variation.exposureHours,
    0,
  );
  const approved = state.variations.reduce(
    (total, variation) => total + variation.approvedHours,
    0,
  );
  const taskNames = new Map(state.tasks.map((task) => [task.id, task.name]));

  return (
    <>
      <section className="metrics-grid compact-metrics" aria-label="Variation metrics">
        <article className="metric-card">
          <span className="metric-label">Open exposure</span>
          <strong className="metric-value">{hours(openExposure)}</strong>
          <span className="metric-detail">Outside approved budget</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Approved change</span>
          <strong className="metric-value">{hours(approved)}</strong>
          <span className="metric-detail">Added to revised task budgets</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Awaiting decision</span>
          <strong className="metric-value">
            {
              state.variations.filter(
                (item) =>
                  !["approved", "rejected", "closed", "paid"].includes(
                    item.status,
                  ),
              ).length
            }
          </strong>
          <span className="metric-detail">Open commercial actions</span>
        </article>
      </section>
      <div className="workspace-grid">
        <section className="panel form-panel">
          <div className="card-heading">
            <div>
              <span className="eyebrow">New change</span>
              <h2>
                Register a potential variation
                <HelpTip
                  topic="variations"
                  summary="Keep unapproved exposure separate from approved task budgets."
                />
              </h2>
            </div>
            <PageExports scope="variations" />
          </div>
          <form className="control-form" onSubmit={onAdd}>
            <Field label="Title">
              <input name="title" required maxLength={180} />
            </Field>
            <Field label="Task allocation">
              <select name="taskId" required defaultValue="">
                <option value="" disabled>Select task</option>
                {state.tasks.map((task) => (
                  <option key={task.id} value={task.id}>{task.name}</option>
                ))}
              </select>
            </Field>
            <div className="form-grid two">
              <Field label="Submitted hours">
                <input name="submittedHours" type="number" min="0" step="0.1" required />
              </Field>
              <Field label="Current exposure">
                <input name="exposureHours" type="number" min="0" step="0.1" required />
              </Field>
              <Field label="Client response due">
                <input name="clientResponseDue" type="date" />
              </Field>
              <Field label="Critical path impact">
                <select name="criticalPathImpact" defaultValue="unknown">
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea name="description" rows={3} maxLength={1200} />
            </Field>
            <SubmitButton busy={busy}>Add variation</SubmitButton>
          </form>
        </section>
        <section className="panel register-summary">
          <span className="eyebrow">Variation register</span>
          <h2>{state.variations.length} controlled changes</h2>
          <div className="summary-stat-grid">
            <div><span>Submitted</span><strong>{hours(state.variations.reduce((sum, item) => sum + item.submittedHours, 0))}</strong></div>
            <div><span>Approved</span><strong>{hours(approved)}</strong></div>
            <div><span>Exposure</span><strong>{hours(openExposure)}</strong></div>
          </div>
          <p className="form-note">
            Open the collapsed register below, then select a row to view every
            field, edit it or delete the entry.
          </p>
        </section>
      </div>

      <section className="panel register-panel">
        <CollapsibleRegister
          title="Variation register"
          count={state.variations.length}
        >
          <div className="responsive-table">
            <table className="clickable-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Title</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Approved</th>
                  <th>Exposure</th>
                  <th>Response due</th>
                </tr>
              </thead>
              <tbody>
                {state.variations.map((variation) => (
                  <tr
                    key={variation.id}
                    tabIndex={0}
                    onClick={() => setSelectedVariation(variation)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelectedVariation(variation);
                    }}
                  >
                    <td><strong>{variation.id}</strong></td>
                    <td>{variation.title}</td>
                    <td>{taskNames.get(variation.taskId ?? "") ?? "Unallocated"}</td>
                    <td>
                      <StatusPill
                        status={
                          ["approved", "paid"].includes(variation.status)
                            ? "good"
                            : ["rejected", "closed"].includes(variation.status)
                              ? "neutral"
                              : "watch"
                        }
                      >
                        {humanise(variation.status)}
                      </StatusPill>
                    </td>
                    <td>{hours(variation.submittedHours)}</td>
                    <td>{hours(variation.approvedHours)}</td>
                    <td>{hours(variation.exposureHours)}</td>
                    <td>{nzDate(variation.clientResponseDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleRegister>
      </section>

      <ItemModal
        open={Boolean(selectedVariation)}
        title="Edit variation"
        onClose={() => setSelectedVariation(null)}
      >
        {selectedVariation ? (
          <form className="control-form modal-form" onSubmit={onUpdate}>
            <input type="hidden" name="id" value={selectedVariation.id} />
            <Field label="Title">
              <input name="title" required defaultValue={selectedVariation.title} />
            </Field>
            <div className="form-grid two">
              <Field label="Allocated task">
                <select name="taskId" required defaultValue={selectedVariation.taskId ?? state.tasks[0]?.id}>
                  {state.tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select name="status" defaultValue={selectedVariation.status}>
                  {variationStatuses.map((status) => (
                    <option key={status} value={status}>{humanise(status)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Submitted hours">
                <input name="submittedHours" type="number" min="0" step="0.1" required defaultValue={selectedVariation.submittedHours} />
              </Field>
              <Field label="Current exposure">
                <input name="exposureHours" type="number" min="0" step="0.1" required defaultValue={selectedVariation.exposureHours} />
              </Field>
              <Field label="Approved hours">
                <input name="approvedHours" type="number" min="0" step="0.1" required defaultValue={selectedVariation.approvedHours} />
              </Field>
              <Field label="Approved physical quantity">
                <input name="approvedUnits" type="number" min="0" step="0.01" required defaultValue={selectedVariation.approvedUnits} />
              </Field>
              <Field label="Client response due">
                <input name="clientResponseDue" type="date" defaultValue={selectedVariation.clientResponseDue ?? ""} />
              </Field>
              <Field label="Critical path impact">
                <select name="criticalPathImpact" defaultValue={selectedVariation.criticalPathImpact}>
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea name="description" rows={4} defaultValue={selectedVariation.description ?? ""} />
            </Field>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={() => void remove()}>
                Delete
              </button>
              <span className="modal-actions-right">
                <button className="button quiet" type="button" onClick={() => setSelectedVariation(null)}>Cancel</button>
                <SubmitButton busy={busy}>Save changes</SubmitButton>
              </span>
            </div>
          </form>
        ) : null}
      </ItemModal>
    </>
  );
}

function QualityWorkspace({ state }: { state: ControlState }) {
  const grouped = useMemo(() => {
    const groups = new Map<ControlCheck["severity"], ControlCheck[]>();
    for (const severity of ["critical", "warning", "information"] as const) {
      groups.set(severity, state.checks.filter((check) => check.severity === severity));
    }
    return groups;
  }, [state.checks]);

  return (
    <>
      <section className="metrics-grid compact-metrics" aria-label="Exception summary">
        {(["critical", "warning", "information"] as const).map((severity) => (
          <article className="metric-card" key={severity}>
            <span className="metric-label">{humanise(severity)}</span>
            <strong className="metric-value">{grouped.get(severity)?.length ?? 0}</strong>
            <span className="metric-detail">
              {severity === "critical"
                ? "Could materially misstate the project"
                : severity === "warning"
                  ? "Requires a manager review"
                  : "Valid assumption or explained exception"}
            </span>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Control checks</span>
            <h2>Exceptions in priority order</h2>
          </div>
          <StatusPill status={state.checks.some((check) => check.severity === "critical") ? "risk" : "good"}>
            {state.checks.length} open
          </StatusPill>
        </div>
        <div className="check-list">
          {state.checks.map((check) => (
            <a className={`check-row ${check.severity}`} href={check.href} key={check.id}>
              <span className="check-icon" aria-hidden="true" />
              <span>
                <strong>{check.title}</strong>
                <small>{check.detail}</small>
              </span>
              <b>{humanise(check.area)}</b>
            </a>
          ))}
          {state.checks.length === 0 ? (
            <div className="empty-state">
              <h2>No open exceptions</h2>
              <p>Source reconciliations and operational checks currently pass.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function HelpWorkspace({ state }: { state: ControlState }) {
  return (
    <div className="help-layout">
      <aside className="panel help-nav">
        <span className="eyebrow">On this page</span>
        <nav>
          <a href="#programme-grid">Programme grid</a>
          <a href="#daily-quantity">Daily physical quantity</a>
          <a href="#item-management">Editing and deleting</a>
          <a href="#materials">Materials</a>
          <a href="#variations">Variations</a>
          <a href="#calendar-exceptions">Calendar exceptions</a>
          <a href="#task-management">Task management</a>
          <a href="#project-settings">Project settings</a>
          <a href="#exports">Exports</a>
        </nav>
      </aside>
      <article className="panel help-content">
        <section id="programme-grid">
          <span className="eyebrow">Programme</span>
          <h2>Interactive man-day allocation grid</h2>
          <p>
            Each dated cell represents man-days for one Savannah task. One
            man-day currently equals one person working{" "}
            {state.project.productiveHoursPerPerson} hours. For example, 2 is
            two people for a full day and 0.5 is half a person-day. Type a value
            into any day and press Enter or click away to save it.
          </p>
          <p>
            Manual values stay fixed. Each entry becomes the new planning
            point: cells before it remain unchanged, while automatic cells
            after it divide the remaining approved task allowance across the
            available weekdays up to the due date. Enter 0 to deliberately
            block a day. Weekend and exception cells remain available for
            deliberate work.
          </p>
          <p>
            Past weeks start collapsed; each can be expanded independently.
            Current and future weeks remain visible. The red line marks today.
            Target and forecast bars can be shown or hidden without changing
            data. Required man-days per day are compared with assigned crew and
            the maximum practical crew so unworkable or over-allocated plans
            remain visible.
          </p>
          <h3>Reset future values</h3>
          <p>
            Reset removes manual entries strictly after today and restores the
            calculated requirement. Historical values, today, the baseline and
            approved changes remain untouched.
          </p>
        </section>

        <section id="daily-quantity">
          <span className="eyebrow">Daily input</span>
          <h2>Physical quantity completed</h2>
          <p>
            “Physical quantity” means the installed output measured in the
            selected task&apos;s unit, such as m², lineal metres, each, rooms or
            another defined measure. Enter today&apos;s increment. The form
            shows the unit beside the field after a task is selected.
          </p>
          <p>
            Labour hours show resources used. Physical quantity shows work
            achieved. Both are needed to calculate earned labour and
            productivity reliably.
          </p>
        </section>

        <section id="item-management">
          <span className="eyebrow">Registers</span>
          <h2>View, edit and delete items</h2>
          <p>
            Input pages place their complete register in a collapsed table
            below the entry form. Open the table and select a row to see every
            stored field. Save applies changes, Cancel closes without saving
            and Delete asks for confirmation before removing the record.
          </p>
        </section>

        <section id="materials">
          <span className="eyebrow">Procurement</span>
          <h2>Material packages</h2>
          <p>
            Link each package to its controlling task. The suggested order date
            counts backwards from the need date using lead time, buffer and the
            project working calendar. Record the PO and confirmed delivery
            separately so supplier confirmation remains visible.
          </p>
        </section>

        <section id="variations">
          <span className="eyebrow">Commercial control</span>
          <h2>Variations</h2>
          <p>
            Submitted and exposure hours remain outside the approved task
            budget. Approved or partially approved hours and physical quantity
            are added to the selected task. Changing or deleting an approved
            variation reverses the previous allocation before applying the new
            one.
          </p>
        </section>

        <section id="calendar-exceptions">
          <span className="eyebrow">Calendar</span>
          <h2>Single-day and date-range exceptions</h2>
          <p>
            Enter a start date and leave the end blank for one day. Enter both
            dates for a shutdown, access delay, weather delay or other
            arbitrary range. Every included weekday is removed from automatic
            projections. Manual programme entries are still allowed.
          </p>
        </section>

        <section id="task-management">
          <span className="eyebrow">Tasks</span>
          <h2>Task controls</h2>
          <p>
            Add a task when approved scope needs a separate labour and
            programme control. Enter its physical unit, total quantity, base
            man-days, dates and crew limits. User-created tasks can be deleted
            after linked daily, material and variation records are removed.
          </p>
          <p>
            Imported baseline names, quantities and labour allowances stay
            protected. Their operational dates, crew, status, criticality and
            access date remain editable.
          </p>
        </section>

        <section id="project-settings">
          <span className="eyebrow">Setup</span>
          <h2>Project settings</h2>
          <p>
            The status date is the controlled cut-off for detailed actuals.
            Hours in one man-day controls grid conversion. Forecast thresholds
            decide when measured productivity is reliable enough to replace
            the original budget rate in management forecasts.
          </p>
        </section>

        <section id="exports">
          <span className="eyebrow">Continuity</span>
          <h2>Exports</h2>
          <p>
            Page-level CSV exports contain the relevant register or programme
            grid. Export PDF opens the browser print dialogue for the current
            view. The master export in the top bar downloads the full project,
            including audit records, for archiving, reporting and testing.
          </p>
        </section>

        <section id="field-help">
          <span className="eyebrow">Forms</span>
          <h2>Field help</h2>
          <p>
            Hover over a question mark for a short explanation. Select it to
            open the relevant section of this page in a separate tab.
          </p>
        </section>
      </article>
    </div>
  );
}

function SetupWorkspace({ state, busy, mutate }: WorkspaceProps) {
  const [selectedException, setSelectedException] = useState<
    ControlState["calendarExceptions"][number] | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<
    ControlState["tasks"][number] | null
  >(null);
  const onProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    await mutate(
      "update-project",
      {
        ...values,
        productiveHoursPerPerson: Number(values.productiveHoursPerPerson),
        minimumProgressPercent: Number(values.minimumProgressPercent),
        minimumProgressUnits: Number(values.minimumProgressUnits),
        nearCriticalDays: Number(values.nearCriticalDays),
      },
      "Project control settings updated and forecasts recalculated.",
    );
  };
  const onException = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const saved = await mutate(
      "add-calendar-exception",
      formObject(form),
      "Calendar exception saved. Programme working days recalculated.",
    );
    if (saved) form.reset();
  };
  const onExceptionUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate(
      "update-calendar-exception",
      formObject(event.currentTarget),
      "Calendar exception updated.",
    );
    if (saved) setSelectedException(null);
  };
  const removeException = async () => {
    if (
      !selectedException ||
      !window.confirm(`Delete “${selectedException.name}” from the calendar?`)
    ) {
      return;
    }
    const deleted = await mutate(
      "delete-calendar-exception",
      { id: selectedException.id },
      "Calendar exception deleted and programme recalculated.",
    );
    if (deleted) setSelectedException(null);
  };
  const onTaskAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const saved = await mutate(
      "add-task",
      {
        ...values,
        originalUnits: Number(values.originalUnits),
        originalBudgetHours:
          Number(values.baseManDays) * state.project.productiveHoursPerPerson,
        assignedStaff: Number(values.assignedStaff),
        maxPracticalCrew: values.maxPracticalCrew
          ? Number(values.maxPracticalCrew)
          : null,
      },
      "Task added to the programme.",
    );
    if (saved) form.reset();
  };
  const onTaskUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const saved = await mutate(
      "update-task",
      {
        ...values,
        originalUnits: Number(values.originalUnits),
        originalBudgetHours:
          Number(values.baseManDays) * state.project.productiveHoursPerPerson,
        assignedStaff: Number(values.assignedStaff),
        maxPracticalCrew: values.maxPracticalCrew
          ? Number(values.maxPracticalCrew)
          : null,
      },
      "Task controls updated and programme recalculated.",
    );
    if (saved) setSelectedTask(null);
  };
  const removeTask = async () => {
    if (
      !selectedTask ||
      !window.confirm(
        `Delete “${selectedTask.name}”? Linked records must be removed first.`,
      )
    ) {
      return;
    }
    const deleted = await mutate(
      "delete-task",
      { id: selectedTask.id },
      "User-created task deleted.",
    );
    if (deleted) setSelectedTask(null);
  };
  const originalTotal = state.tasks.reduce(
    (total, task) => total + task.originalBudgetHours,
    0,
  );
  const revisedTotal = state.tasks.reduce(
    (total, task) => total + task.originalBudgetHours + task.approvedVariationHours,
    0,
  );

  return (
    <div className="setup-stack">
      <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Control settings</span>
            <h2>
              Project dates and forecast thresholds
              <HelpTip
                topic="project-settings"
                summary="These settings control the status cut-off, conversion to man-days and forecast thresholds."
              />
            </h2>
          </div>
          <StatusPill status="neutral">Audit logged</StatusPill>
        </div>
        <form className="control-form" onSubmit={onProject}>
          <div className="form-grid three">
            <Field label="Status date">
              <input name="statusDate" type="date" required defaultValue={state.project.statusDate} />
            </Field>
            <Field label="Target finish">
              <input name="targetFinish" type="date" required defaultValue={state.project.targetFinish} />
            </Field>
            <Field
              label="Hours in one man-day"
              help="Every programme-grid value is multiplied by this number. Savannah's current standard is 8.9 hours."
              helpTopic="programme-grid"
            >
              <input name="productiveHoursPerPerson" type="number" min="0.1" max="24" step="0.1" required defaultValue={state.project.productiveHoursPerPerson} />
            </Field>
            <Field label="Actual-rate threshold (%)">
              <input name="minimumProgressPercent" type="number" min="1" max="100" step="1" required defaultValue={state.project.minimumProgressPercent * 100} />
            </Field>
            <Field label="Actual-rate threshold (units)">
              <input name="minimumProgressUnits" type="number" min="0.01" step="0.01" required defaultValue={state.project.minimumProgressUnits} />
            </Field>
            <Field label="Near-critical window (days)">
              <input name="nearCriticalDays" type="number" min="0" max="90" required defaultValue={state.project.nearCriticalDays} />
            </Field>
          </div>
          <p className="form-note">
            The actual production rate is used after either threshold is met.
            Before then, the controlled budget rate remains the default.
          </p>
          <SubmitButton busy={busy}>Save control settings</SubmitButton>
        </form>
      </section>

      <div className="workspace-grid">
        <section className="panel">
          <span className="eyebrow">Source controls</span>
          <h2>Imported baseline reconciliation</h2>
          <dl className="source-reconciliation">
            <div><dt>Fictional demo allowance</dt><dd>{hours(1825.9)}</dd></div>
            <div><dt>Allocated original task hours</dt><dd>{hours(originalTotal)}</dd></div>
            <div><dt>Approved variation hours</dt><dd>{hours(revisedTotal - originalTotal)}</dd></div>
            <div><dt>Current revised budget</dt><dd>{hours(revisedTotal)}</dd></div>
          </dl>
          <StatusPill status={Math.abs(originalTotal - 1825.9) < 0.005 ? "good" : "risk"}>
            {Math.abs(originalTotal - 1825.9) < 0.005
              ? "Baseline reconciles"
              : "Reconciliation failed"}
          </StatusPill>
          <p className="form-note">
            Imported hours remain authoritative. Changing the management rate
            never silently changes those hours.
          </p>
        </section>

        <section className="panel form-panel">
          <span className="eyebrow">Working calendar</span>
          <h2>
            Calendar exceptions
            <HelpTip
              topic="calendar-exceptions"
              summary="Exclude one day or an arbitrary date range from automatic weekday projections."
            />
          </h2>
          <form className="control-form compact-form" onSubmit={onException}>
            <div className="form-grid two">
              <Field label="Start date"><input name="startDate" type="date" required /></Field>
              <Field
                label="End date"
                help="Leave blank for a single-day exception."
                helpTopic="calendar-exceptions"
              >
                <input name="endDate" type="date" />
              </Field>
              <Field label="Reason"><input name="name" required maxLength={100} placeholder="Weather delay, shutdown, holiday…" /></Field>
            </div>
            <SubmitButton busy={busy}>Add exception</SubmitButton>
          </form>
          <CollapsibleRegister
            title="Calendar exception register"
            count={state.calendarExceptions.length}
          >
            <div className="responsive-table compact-table">
              <table className="clickable-table">
                <thead><tr><th>Reason</th><th>Start</th><th>End</th></tr></thead>
                <tbody>
                  {state.calendarExceptions.map((exception) => (
                    <tr
                      key={exception.id}
                      tabIndex={0}
                      onClick={() => setSelectedException(exception)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelectedException(exception);
                      }}
                    >
                      <td>{exception.name}</td>
                      <td>{nzDate(exception.startDate)}</td>
                      <td>{nzDate(exception.endDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleRegister>
        </section>
      </div>

      <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Task controls</span>
            <h2>
              Add or manage Savannah tasks
              <HelpTip
                topic="task-management"
                summary="Add approved extra tasks or update operational dates, crew, status and criticality."
              />
            </h2>
          </div>
          <PageExports scope="tasks" />
        </div>
        <p className="section-copy">
          Imported task allowances remain protected. User-created tasks can be
          fully edited and deleted while they have no linked records.
        </p>
        <form className="control-form task-add-form" onSubmit={onTaskAdd}>
          <div className="form-grid three">
            <Field label="Task name"><input name="name" required maxLength={180} /></Field>
            <Field label="Work package"><input name="workPackage" required maxLength={120} /></Field>
            <Field label="Workfront"><input name="workfront" defaultValue="Whole project" required /></Field>
            <Field label="Physical unit of measure"><input name="trackingUom" placeholder="m², lm, ea, rooms…" required maxLength={40} /></Field>
            <Field label="Total physical quantity"><input name="originalUnits" type="number" min="0.01" step="0.01" required /></Field>
            <Field
              label="Base man-days"
              help={`One man-day equals ${state.project.productiveHoursPerPerson} labour hours.`}
              helpTopic="task-management"
            >
              <input name="baseManDays" type="number" min="0.1" step="0.1" required />
            </Field>
            <Field label="Target start"><input name="targetStart" type="date" required /></Field>
            <Field label="Target finish"><input name="targetFinish" type="date" required /></Field>
            <Field label="Assigned crew"><input name="assignedStaff" type="number" min="0" step="0.1" required defaultValue="1" /></Field>
            <Field label="Maximum practical crew"><input name="maxPracticalCrew" type="number" min="0.1" step="0.1" /></Field>
            <Field label="Status">
              <select name="status" defaultValue="not-started">
                <option value="not-started">Not started</option>
                <option value="in-progress">In progress</option>
                <option value="on-hold">On hold</option>
                <option value="complete">Complete</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Criticality">
              <select name="criticality" defaultValue="unknown">
                <option value="unknown">Unknown</option>
                <option value="critical">Critical</option>
                <option value="near-critical">Near-critical</option>
                <option value="non-critical">Non-critical</option>
              </select>
            </Field>
          </div>
          <SubmitButton busy={busy}>Add task</SubmitButton>
        </form>
        <CollapsibleRegister title="Savannah task register" count={state.tasks.length}>
          <div className="responsive-table">
            <table className="clickable-table">
              <thead>
                <tr><th>Task</th><th>Package</th><th>Due</th><th>Crew</th><th>Base man-days</th><th>Status</th><th>Source</th></tr>
              </thead>
              <tbody>
                {state.tasks.map((task) => (
                  <tr
                    key={task.id}
                    tabIndex={0}
                    onClick={() => setSelectedTask(task)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelectedTask(task);
                    }}
                  >
                    <td><strong>{task.name}</strong><small>{task.trackingUom}</small></td>
                    <td>{task.workPackage}</td>
                    <td>{nzDate(task.targetFinish)}</td>
                    <td>{task.assignedStaff}</td>
                    <td>{(task.originalBudgetHours / state.project.productiveHoursPerPerson).toFixed(1)}</td>
                    <td>{humanise(task.status)}</td>
                    <td>{task.userCreated ? "User added" : "Imported baseline"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleRegister>
      </section>

      <section className="panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Continuity</span>
            <h2>Export and operating safeguards</h2>
          </div>
          <div className="button-group">
            <Link className="button secondary" href="/api/export?format=csv&scope=all">Project CSV bundle</Link>
            <Link className="button primary" href="/api/export">Master project export</Link>
          </div>
        </div>
        <div className="safeguard-grid">
          <div><strong>Shared demo data</strong><span>Public visitors share this fictional sandbox. Deploy a private job instance for operational data.</span></div>
          <div><strong>Immutable baseline</strong><span>Approved variations revise the target without overwriting source allowances.</span></div>
          <div><strong>Recoverable forecasts</strong><span>Reset clears only manual overrides; actuals, approvals and targets stay intact.</span></div>
          <div><strong>Portable records</strong><span>Export before major changes and at each reporting cycle.</span></div>
        </div>
      </section>

      <ItemModal
        open={Boolean(selectedException)}
        title="Edit calendar exception"
        onClose={() => setSelectedException(null)}
      >
        {selectedException ? (
          <form className="control-form modal-form" onSubmit={onExceptionUpdate}>
            <input type="hidden" name="id" value={selectedException.id} />
            <Field label="Reason"><input name="name" required defaultValue={selectedException.name} /></Field>
            <div className="form-grid two">
              <Field label="Start date"><input name="startDate" type="date" required defaultValue={selectedException.startDate} /></Field>
              <Field label="End date"><input name="endDate" type="date" required defaultValue={selectedException.endDate} /></Field>
            </div>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={() => void removeException()}>Delete</button>
              <span className="modal-actions-right">
                <button className="button quiet" type="button" onClick={() => setSelectedException(null)}>Cancel</button>
                <SubmitButton busy={busy}>Save changes</SubmitButton>
              </span>
            </div>
          </form>
        ) : null}
      </ItemModal>

      <ItemModal
        open={Boolean(selectedTask)}
        title="Edit task controls"
        onClose={() => setSelectedTask(null)}
      >
        {selectedTask ? (
          <form className="control-form modal-form" onSubmit={onTaskUpdate}>
            <input type="hidden" name="id" value={selectedTask.id} />
            <div className="form-grid two">
              <Field label="Task name">
                <input name="name" required defaultValue={selectedTask.name} readOnly={!selectedTask.userCreated} />
              </Field>
              <Field label="Work package">
                <input name="workPackage" required defaultValue={selectedTask.workPackage} readOnly={!selectedTask.userCreated} />
              </Field>
              <Field label="Workfront"><input name="workfront" required defaultValue={selectedTask.workfront} /></Field>
              <Field label="Physical unit">
                <input name="trackingUom" required defaultValue={selectedTask.trackingUom} readOnly={!selectedTask.userCreated} />
              </Field>
              <Field label="Total physical quantity">
                <input name="originalUnits" type="number" min="0.01" step="0.01" required defaultValue={selectedTask.originalUnits} readOnly={!selectedTask.userCreated} />
              </Field>
              <Field label="Base man-days">
                <input name="baseManDays" type="number" min="0.1" step="0.1" required defaultValue={(selectedTask.originalBudgetHours / state.project.productiveHoursPerPerson).toFixed(2)} readOnly={!selectedTask.userCreated} />
              </Field>
              <Field label="Target start"><input name="targetStart" type="date" required defaultValue={selectedTask.targetStart} /></Field>
              <Field label="Target finish"><input name="targetFinish" type="date" required defaultValue={selectedTask.targetFinish} /></Field>
              <Field label="Assigned crew"><input name="assignedStaff" type="number" min="0" step="0.1" required defaultValue={selectedTask.assignedStaff} /></Field>
              <Field label="Maximum practical crew"><input name="maxPracticalCrew" type="number" min="0.1" step="0.1" defaultValue={selectedTask.maxPracticalCrew ?? ""} /></Field>
              <Field label="Access available"><input name="accessDate" type="date" defaultValue={selectedTask.accessDate ?? ""} /></Field>
              <Field label="Status">
                <select name="status" defaultValue={selectedTask.status}>
                  <option value="not-started">Not started</option>
                  <option value="in-progress">In progress</option>
                  <option value="on-hold">On hold</option>
                  <option value="complete">Complete</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Criticality">
                <select name="criticality" defaultValue={selectedTask.criticality}>
                  <option value="unknown">Unknown</option>
                  <option value="critical">Critical</option>
                  <option value="near-critical">Near-critical</option>
                  <option value="non-critical">Non-critical</option>
                </select>
              </Field>
            </div>
            {!selectedTask.userCreated ? (
              <p className="form-note">Imported names, quantities and base labour are protected. Operational dates, crew, status, criticality and access remain editable.</p>
            ) : null}
            <div className="modal-actions">
              {selectedTask.userCreated ? (
                <button className="button danger" type="button" onClick={() => void removeTask()}>Delete</button>
              ) : <span />}
              <span className="modal-actions-right">
                <button className="button quiet" type="button" onClick={() => setSelectedTask(null)}>Cancel</button>
                <SubmitButton busy={busy}>Save changes</SubmitButton>
              </span>
            </div>
          </form>
        ) : null}
      </ItemModal>
    </div>
  );
}
