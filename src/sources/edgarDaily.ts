import type { SecHttp } from "./http";

/**
 * EDGAR daily form index and filing submission text, the daily path for Form
 * 3/4/5 insider filings (the quarterly data sets lag by up to a quarter).
 *
 * Verified 2026-09-14: `daily-index/2026/QTR3/form.20260911.idx` served 895 Form
 * 4, 26 Form 4/A and 128 Form 3 lines, and each listed `edgar/data/{cik}/{accession}.txt`
 * carries an `<ACCEPTANCE-DATETIME>` header and an `<ownershipDocument>` XML body.
 * EDGAR serves 403, not 404, for weekend dates — measured 2026-09-18 from two
 * egresses with the declared UA: every weekday index was 200 and Sat/Sun was
 * 403. Weekend dates are therefore skipped before HTTP. A weekday 403 remains
 * a real denial signal; relabelling it as "unpublished" would hide an egress
 * block and allow the lake to go silently stale.
 */
const EDGAR_ARCHIVES = "https://www.sec.gov/Archives";

export function edgarDailyFormIndexUrl(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`EDGAR daily index date must be YYYY-MM-DD, got "${isoDate}"`);
  const [, year, month, day] = match;
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;
  return `${EDGAR_ARCHIVES}/edgar/daily-index/${year}/QTR${quarter}/form.${year}${month}${day}.idx`;
}

export function edgarArchiveUrl(fileName: string): string {
  return `${EDGAR_ARCHIVES}/${fileName.replace(/^\/+/, "")}`;
}

export function isWeekendEdgarIndexDate(isoDate: string): boolean {
  edgarDailyFormIndexUrl(isoDate);
  const day = new Date(`${isoDate}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** The day's form index text, or null when EDGAR published no index that day. */
export async function fetchEdgarDailyFormIndex(
  http: SecHttp,
  isoDate: string
): Promise<string | null> {
  if (isWeekendEdgarIndexDate(isoDate)) return null;
  try {
    return (await http.get(edgarDailyFormIndexUrl(isoDate))).toString("utf8");
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

/** Full submission text (`.txt`) for an index `File Name`. */
export async function fetchEdgarFilingText(http: SecHttp, fileName: string): Promise<string> {
  return (await http.get(edgarArchiveUrl(fileName))).toString("utf8");
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
