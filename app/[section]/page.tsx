import { notFound } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { ControlWorkspace } from "../components/control-workspace";
import { shortNzDate } from "../../lib/date";
import { loadControlState } from "../../lib/control-state";

const sections: Record<
  string,
  { title: string; description: string; guidance: string }
> = {
  daily: {
    title: "Daily labour and progress",
    description:
      "Record one line for each Savannah task worked on today. Enter total labour hours and the physical units completed during the day.",
    guidance:
      "Daily quantities preserve history. Use a variation reference whenever the work sits outside approved scope.",
  },
  programme: {
    title: "Savannah programme",
    description:
      "Review target and forecast dates, day-level labour demand and current criticality for Savannah scope.",
    guidance:
      "The current forecast responds to measured progress, remaining hours, assigned staff, materials and access constraints.",
  },
  materials: {
    title: "Materials and procurement",
    description:
      "Manage material packages, component lead times, need dates, order dates and confirmed delivery dates.",
    guidance:
      "The suggested order date protects the earlier of target and forecast need unless an authorised manual need date is recorded.",
  },
  variations: {
    title: "Variation control",
    description:
      "Keep potential, submitted, at-risk and approved scope visible without rewriting the original budget.",
    guidance:
      "Approved allocations revise the controlled budget. At-risk hours stay separate as management exposure.",
  },
  quality: {
    title: "Data quality and exceptions",
    description:
      "Review mapping, labour, progress, procurement, programme and approval checks from one action queue.",
    guidance:
      "Critical errors can make a result materially wrong. Warnings require review; information items document valid assumptions.",
  },
  setup: {
    title: "Project setup",
    description:
      "Configure project dates, the working calendar, source mappings, task units, forecast defaults and access responsibilities.",
    guidance:
      "Baseline data becomes immutable after approval. All later approved changes are recorded separately.",
  },
  help: {
    title: "Help",
    description:
      "Use this guide for programme entry, forecasting, registers, task controls, calendar exceptions and exports.",
    guidance:
      "Question-mark links throughout the system open the relevant section of this page in a separate tab.",
  },
};

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const content = sections[section];
  if (!content) notFound();
  const state = await loadControlState();

  return (
    <AppShell
      active={`/${section}`}
      projectName={state.project.name}
      statusDate={shortNzDate(state.project.statusDate)}
    >
      <section className="page-heading">
        <div>
          <span className="eyebrow">Project workspace</span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
      </section>
      <div className="page-guidance">
        <span>{content.guidance}</span>
      </div>
      <ControlWorkspace
        section={
          section as
            | "daily"
            | "programme"
            | "materials"
            | "variations"
            | "quality"
            | "help"
            | "setup"
        }
      />
    </AppShell>
  );
}
