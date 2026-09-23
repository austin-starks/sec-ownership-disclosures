import moment from "moment-timezone";

/**
 * Date handling for disclosure sources, which publish dates without times.
 *
 * `availableAt` for a date-only filing is the END of that date in New York, not
 * its start: a House, Senate or SEC quarterly-dataset filing dated D may have been
 * posted at any time on D, so the earliest instant a decision can safely act on
 * it is 23:59:59.999 America/New_York on D. Starting the day would let a backtest
 * trade on a filing hours before it existed.
 */
const NEW_YORK = "America/New_York";

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function isoDate(year: number, month: number, day: number, raw: string): string {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!moment.utc(iso, "YYYY-MM-DD", true).isValid()) {
    throw new Error(`Invalid calendar date: "${raw}"`);
  }
  return iso;
}

/** End of an ISO calendar date (YYYY-MM-DD) in New York, as a UTC instant. */
export function endOfDayNewYork(isoCalendarDate: string): Date {
  const day = moment.tz(isoCalendarDate, "YYYY-MM-DD", true, NEW_YORK);
  if (!day.isValid()) throw new Error(`Invalid calendar date: "${isoCalendarDate}"`);
  return day.endOf("day").toDate();
}

/**
 * EDGAR's `<ACCEPTANCE-DATETIME>` header (YYYYMMDDHHmmss) is New York clock time.
 * Verified 2026-09-14: accession 0001610717-26-000414 carries 20260911164739 in its
 * header and 2026-09-11T20:47:39.000Z in the submissions JSON, four hours apart
 * under daylight time.
 */
export function parseEdgarAcceptanceDateTime(raw: string): Date {
  const value = raw.trim();
  const parsed = moment.tz(value, "YYYYMMDDHHmmss", true, NEW_YORK);
  if (!parsed.isValid()) throw new Error(`Unrecognized EDGAR acceptance datetime: "${value}"`);
  return parsed.toDate();
}

/** SEC data set dates such as "31-OCT-2025". Blank is null. */
export function parseSecDatasetDate(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  const month = match ? MONTHS[(match[2] ?? "").toUpperCase()] : undefined;
  if (!match || !month) throw new Error(`Unrecognized SEC data set date: "${value}"`);
  return isoDate(Number(match[3]), month, Number(match[1]), value);
}

/** House and Senate dates such as "1/23/2024" or "06/2/2020". Blank is null. */
export function parseSlashDate(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Unrecognized M/D/YYYY date: "${value}"`);
  return isoDate(Number(match[3]), Number(match[1]), Number(match[2]), value);
}
