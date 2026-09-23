import type { SecHttp } from "./http";
import type { CalendarQuarter } from "./thirteenFDatasets";

/**
 * SEC's quarterly Form 3/4/5 insider transaction data sets: one ZIP per quarter
 * holding SUBMISSION, REPORTINGOWNER, NONDERIV_TRANS, DERIV_TRANS, FOOTNOTES and
 * holdings TSVs.
 *
 * **SEC serves these from two paths and neither is a superset.** Measured
 * 2026-09-23 by HEAD, with `content-length`:
 *
 * | quarter | `structureddata` | `datastandardsinnovation` |
 * |---|---|---|
 * | 2025q4 | 200, 8,309,708 | 404 |
 * | 2026q1 | 200, 13,874,904 | 404 |
 * | 2026q2 | 404 | 200, 11,498,860 |
 * | 2026q3 | 404 | 404 (quarter not over) |
 *
 * So a 404 on ONE path does not mean the quarter is unpublished. This file
 * previously said it did — "a quarter SEC has not published yet (2026q2)
 * returns 404", written 2026-09-14 from exactly that inference — and a lake
 * built with it silently stopped at 2026q1 while SEC's own listing page linked
 * 2026q2 the whole time. Walking quarters forward still works; it just has to
 * ask both places before believing a quarter is missing.
 *
 * EDGAR serves 403, not 404, for weekend daily indexes — and a weekday 403 is
 * a real denial signal, never "unpublished". The same discipline applies here:
 * only 404 advances to the next candidate; anything else rethrows.
 */
const FORM_345_DATASET_BASES = [
  "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets",
  "https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets",
] as const;

/** Every URL SEC is known to serve this quarter from, in probe order. */
export function form345DatasetUrls(year: number, quarter: CalendarQuarter): string[] {
  return FORM_345_DATASET_BASES.map(
    (base) => `${base}/${year}q${quarter}_form345.zip`
  );
}

/** The first candidate, for logs and error messages. */
export function form345DatasetUrl(year: number, quarter: CalendarQuarter): string {
  return form345DatasetUrls(year, quarter)[0]!;
}

export interface Form345Dataset {
  zip: Buffer;
  /** The URL that actually served it. */
  url: string;
}

/** The quarter's ZIP, or null when no known path serves it. */
export async function fetchForm345Dataset(
  http: SecHttp,
  year: number,
  quarter: CalendarQuarter
): Promise<Form345Dataset | null> {
  for (const url of form345DatasetUrls(year, quarter)) {
    try {
      return { zip: await http.get(url), url };
    } catch (error) {
      if (statusOf(error) === 404) continue;
      throw error;
    }
  }
  return null;
}

/** Back-compatible shape: the bytes alone. */
export async function fetchForm345DatasetZip(
  http: SecHttp,
  year: number,
  quarter: CalendarQuarter
): Promise<Buffer | null> {
  const dataset = await fetchForm345Dataset(http, year, quarter);
  return dataset ? dataset.zip : null;
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
