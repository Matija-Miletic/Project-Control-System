export type HealthStatus = "good" | "watch" | "risk" | "neutral";

export type CriticalityStatus =
  | "critical"
  | "near-critical"
  | "non-critical"
  | "unknown";

export type ProgressMethod =
  | "continuous"
  | "equal-units"
  | "weighted-units"
  | "milestones"
  | "manual";

export interface Project {
  id: string;
  name: string;
  client: string;
  projectManager: string;
  siteManager: string;
  statusDate: string;
  originalStart: string;
  originalFinish: string;
  targetFinish: string;
  handoverDate: string;
  productiveHoursPerPerson: number;
  minimumProgressPercent: number;
  minimumProgressUnits: number;
  nearCriticalDays: number;
  displayMode: "hours" | "hours-and-value" | "management";
  hourlyRate: number | null;
}

export interface Task {
  id: string;
  name: string;
  workPackage: string;
  workfront: string;
  trackingUom: string;
  progressMethod: ProgressMethod;
  originalUnits: number;
  approvedVariationUnits: number;
  originalBudgetHours: number;
  approvedVariationHours: number;
  assignedStaff: number;
  maxPracticalCrew: number | null;
  targetStart: string;
  targetFinish: string;
  originalStart: string;
  originalFinish: string;
  criticality: CriticalityStatus;
  criticalitySource:
    | "calculated"
    | "client-designated"
    | "manual"
    | "unknown";
  status: "not-started" | "in-progress" | "on-hold" | "complete" | "cancelled";
  manualForecastRate: number | null;
  manualForecastStart: string | null;
  manualForecastFinish: string | null;
  accessDate: string | null;
  userCreated: boolean;
}

export interface DailyEntry {
  id: string;
  taskId: string;
  date: string;
  labourHours: number;
  unitsCompleted: number;
  reworkHours: number;
  variationId?: string | null;
  variationStatus: "none" | "approved" | "at-risk" | "rejected";
  delayReason: string | null;
  workfront?: string;
  notes?: string;
}

export interface MaterialPackage {
  id: string;
  name: string;
  taskIds: string[];
  component?: string;
  supplier?: string;
  leadTimeWorkingDays?: number;
  bufferWorkingDays?: number;
  requiredOnSiteDate: string | null;
  forecastNeedDate?: string | null;
  manualNeedDate?: string | null;
  suggestedOrderDate: string | null;
  purchaseOrderNumber?: string | null;
  purchaseOrderDate: string | null;
  confirmedDeliveryDate: string | null;
  status:
    | "not-identified"
    | "selection-required"
    | "ready-to-order"
    | "po-issued"
    | "in-production"
    | "in-transit"
    | "delivered"
    | "complete";
  critical: boolean;
  notes?: string;
}

export interface Variation {
  id: string;
  taskId?: string;
  title: string;
  status:
    | "potential"
    | "pricing"
    | "submitted"
    | "instructed"
    | "proceeding-at-risk"
    | "approved"
    | "partially-approved"
    | "rejected"
    | "complete"
    | "claimed"
    | "paid"
    | "closed";
  submittedHours: number;
  approvedHours: number;
  approvedUnits: number;
  exposureHours: number;
  criticalPathImpact: "yes" | "no" | "unknown";
  clientResponseDue: string | null;
  description?: string;
}

export interface CalendarException {
  id: string;
  startDate: string;
  endDate: string;
  name: string;
  treatment: "non-working";
}

export interface ProgrammeDayValue {
  taskId: string;
  date: string;
  manDays: number;
  note: string;
  updatedAt: string;
}

export type ProgrammeCellKind =
  | "actual"
  | "manual"
  | "projected"
  | "weekend"
  | "exception"
  | "blank";

export interface ProgrammeCell {
  date: string;
  manDays: number | null;
  kind: ProgrammeCellKind;
  editable: boolean;
  note?: string;
}

export interface ProgrammeRow {
  taskId: string;
  taskName: string;
  workPackage: string;
  status: Task["status"];
  targetStart: string;
  targetFinish: string;
  forecastStart: string;
  forecastFinish: string;
  revisedManDays: number;
  fixedManDays: number;
  remainingManDays: number;
  scheduledManDays: number;
  allocationVarianceManDays: number;
  requiredManDaysPerWorkingDay: number;
  assignedCrew: number;
  maxPracticalCrew: number | null;
  feasibility:
    | "achievable"
    | "needs-crew"
    | "not-achievable"
    | "over-allocated"
    | "complete";
  latestManualDate: string | null;
  cells: ProgrammeCell[];
}

export interface ProgrammeState {
  today: string;
  startDate: string;
  finishDate: string;
  dates: string[];
  rows: ProgrammeRow[];
  dailyDemand: Array<{ date: string; manDays: number }>;
}

export interface TaskMetric {
  task: Task;
  revisedUnits: number;
  revisedBudgetHours: number;
  actualHours: number;
  atRiskHours: number;
  completedUnits: number;
  progressPercent: number;
  earnedHours: number;
  productivityVariance: number;
  selectedForecastHoursPerUnit: number;
  forecastBasis: "budget-rate" | "actual-to-date" | "manual";
  forecastRemainingHours: number;
  forecastTotalHours: number;
  forecastVariance: number;
  requiredStaffFte: number | null;
  recommendedStaff: number;
  defaultForecastStart: string;
  defaultForecastFinish: string;
  displayedForecastStart: string;
  displayedForecastFinish: string;
  health: HealthStatus;
  flags: string[];
}

export interface ControlCheck {
  id: string;
  severity: "critical" | "warning" | "information";
  area:
    | "costing"
    | "programme"
    | "daily"
    | "materials"
    | "variations"
    | "setup";
  title: string;
  detail: string;
  href: string;
}

export interface ControlState {
  project: Project;
  tasks: Task[];
  entries: DailyEntry[];
  materials: MaterialPackage[];
  variations: Variation[];
  calendarExceptions: CalendarException[];
  holidayDates: string[];
  programmeDayValues: ProgrammeDayValue[];
  programme: ProgrammeState;
  metrics: TaskMetric[];
  checks: ControlCheck[];
  lastUpdatedAt: string;
}
