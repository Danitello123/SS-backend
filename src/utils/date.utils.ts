/**
 * Resolves a "date" column value (e.g. "2026-10-17") to the end of that
 * calendar day in UTC (23:59:59.999Z), since Postgres `date` columns carry
 * no time component and TypeORM returns them as bare YYYY-MM-DD strings.
 * A value that already carries a time component is returned unchanged.
 */
export function endOfDayUTC(dueDate: Date | string): Date {
  if (typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return new Date(`${dueDate}T23:59:59.999Z`);
  }

  const date = new Date(dueDate);
  const isMidnightUTC =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;

  if (isMidnightUTC) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

/**
 * Checks whether a due date has passed, treating a date-only value as
 * expiring at the end of that day (UTC) rather than at its start.
 */
export function isPastDueDate(dueDate: Date | string, referenceDate: Date = new Date()): boolean {
  return endOfDayUTC(dueDate).getTime() < referenceDate.getTime();
}
