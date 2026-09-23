import type { SecHttp } from "./http";

/**
 * SEC's quarterly Form 13F data sets: one ZIP per quarter holding COVERPAGE,
 * INFOTABLE, SUBMISSION and related TSVs. Verified 2026-09-22: two naming eras
 * coexist — classic `{YYYY}q{N}_form13f.zip` back to 2013Q2, and
 * acceptance-window names such as `01mar2026-31may2026_form13f.zip` for recent
 * quarters — under two base paths. Callers pass explicit candidates; nothing
 * here guesses a window label from a calendar quarter.
 */
const DATASET_BASES = [
  "https://www.sec.gov/files/structureddata/data/form-13f-data-sets",
  "https://www.sec.gov/files/datastandardsinnovation/data/form-13f-data-sets",
] as const;



export type CalendarQuarter = 1 | 2 | 3 | 4;

export function thirteenFQuarterFilename(year: number, quarter: CalendarQuarter): string {
  return `${year}q${quarter}_form13f.zip`;
}

/** Candidate URLs for a classic quarterly data set, preferred base first. */
export function thirteenFQuarterUrls(year: number, quarter: CalendarQuarter): string[] {
  const filename = thirteenFQuarterFilename(year, quarter);
  return DATASET_BASES.map((base) => `${base}/${filename}`);
}

/** Candidate URLs for an acceptance-window data set such as `01mar2026-31may2026_form13f`. */
export function thirteenFWindowUrls(windowLabel: string): string[] {
  if (!/^[0-9a-z-]+_form13f$/i.test(windowLabel)) {
    throw new Error(`Window label must look like 01mar2026-31may2026_form13f, got "${windowLabel}"`);
  }
  return DATASET_BASES.map((base) => `${base}/${windowLabel}.zip`);
}

/**
 * The data set ZIP from the first candidate URL that serves it, or null when
 * every candidate 404s (a window SEC has not published). Large quarters are
 * ~100 MB: run the backfill on Fly, never on a laptop.
 */
export async function fetchThirteenFDatasetZip(
  http: SecHttp,
  urls: readonly string[]
): Promise<Buffer | null> {
  if (urls.length === 0) throw new Error("fetchThirteenFDatasetZip needs at least one candidate URL");
  for (const url of urls) {
    try {
      return await http.get(url);
    } catch (error) {
      if (statusOf(error) === 404) continue;
      throw error;
    }
  }
  return null;
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
