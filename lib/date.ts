const DAY_MS = 86_400_000;

export function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function dateRangeInclusive(start: string, finish: string): string[] {
  if (compareDates(finish, start) < 0) return [];
  const dates: string[] = [];
  let cursor = start;
  while (compareDates(cursor, finish) <= 0) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function startOfIsoWeek(value: string): string {
  const day = parseDate(value).getUTCDay();
  return addCalendarDays(value, -(day === 0 ? 6 : day - 1));
}

export function endOfIsoWeek(value: string): string {
  return addCalendarDays(startOfIsoWeek(value), 6);
}

export function nzToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Pacific/Auckland",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve the New Zealand date.");
  }
  return `${year}-${month}-${day}`;
}

export function compareDates(a: string, b: string): number {
  return parseDate(a).getTime() - parseDate(b).getTime();
}

export function maxDate(...values: Array<string | null | undefined>): string {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) {
    throw new Error("At least one date is required");
  }
  return present.reduce((latest, value) =>
    compareDates(value, latest) > 0 ? value : latest,
  );
}

export function isWorkingDay(
  value: string,
  holidayDates: ReadonlySet<string>,
): boolean {
  const day = parseDate(value).getUTCDay();
  return day !== 0 && day !== 6 && !holidayDates.has(value);
}

export function nextWorkingDay(
  value: string,
  holidayDates: ReadonlySet<string>,
): string {
  let cursor = addCalendarDays(value, 1);
  while (!isWorkingDay(cursor, holidayDates)) {
    cursor = addCalendarDays(cursor, 1);
  }
  return cursor;
}

export function onOrNextWorkingDay(
  date: string,
  holidays: ReadonlySet<string>,
): string {
  const cursor = parseDate(date);
  while (!isWorkingDay(formatDate(cursor), holidays)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return formatDate(cursor);
}

export function addWorkingDays(
  value: string,
  workingDays: number,
  holidayDates: ReadonlySet<string>,
): string {
  if (workingDays <= 0) return value;
  let cursor = value;
  let remaining = workingDays;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor, holidayDates)) remaining -= 1;
  }
  return cursor;
}

export function subtractWorkingDays(
  value: string,
  workingDays: number,
  holidayDates: ReadonlySet<string>,
): string {
  if (workingDays <= 0) return value;
  let cursor = value;
  let remaining = workingDays;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, -1);
    if (isWorkingDay(cursor, holidayDates)) remaining -= 1;
  }
  return cursor;
}

export function workingDaysInclusive(
  start: string,
  finish: string,
  holidayDates: ReadonlySet<string>,
): number {
  if (compareDates(finish, start) < 0) return 0;
  let cursor = start;
  let total = 0;
  while (compareDates(cursor, finish) <= 0) {
    if (isWorkingDay(cursor, holidayDates)) total += 1;
    cursor = addCalendarDays(cursor, 1);
  }
  return total;
}

export function calendarDaysBetween(start: string, finish: string): number {
  return Math.round(
    (parseDate(finish).getTime() - parseDate(start).getTime()) / DAY_MS,
  );
}

export function shortNzDate(value: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDate(value));
}
