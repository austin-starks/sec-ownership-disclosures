import type { SecHttp } from "./http";
import type { CalendarQuarter } from "./thirteenFDatasets";

/**
 * SEC's quarterly Form 3/4/5 insider transaction data sets: one ZIP per quarter
 * holding SUBMISSION, REPORTINGOWNER, NONDERIV_TRANS, DERIV_TRANS, FOOTNOTES and
 * holdings TSVs. Verified 2026-09-14: 2006q1 and 2025q4 serve the ZIP; a quarter
 * SEC has not published yet (2026q2) returns 404, so callers can walk quarters
 * forward without scraping a listing page.
 *
 * EDGAR serves 403, not 404, for weekend daily indexes — and a weekday 403 is
 * a real denial signal, never "unpublished". The same discipline applies here:
 * only 404 means "not published"; anything else rethrows.
 */
const FORM_345_DATASET_BASE =
  "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets";

export function form345DatasetUrl(year: number, quarter: CalendarQuarter): string {
  return `${FORM_345_DATASET_BASE}/${year}q${quarter}_form345.zip`;
}

/** The quarter's ZIP, or null when SEC has not published it. */
export async function fetchForm345DatasetZip(
  http: SecHttp,
  year: number,
  quarter: CalendarQuarter
): Promise<Buffer | null> {
  try {
    return await http.get(form345DatasetUrl(year, quarter));
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
