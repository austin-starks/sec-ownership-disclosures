import { describeError } from "../utils/retry";
import { insiderIndexEntries, parseEdgarDailyFormIndex, type EdgarIndexEntry } from "../sources/edgarDailyIndex";
import type { Form345DatasetRows } from "../extraction/form345Dataset";
import { parseEdgarOwnershipSubmission } from "../extraction/form4Xml";

/**
 * The SEC step of the daily disclosures job: EDGAR's daily form indexes list what
 * was filed, and the accessions already in the insider tables decide what is
 * done. Every other Form 3, 4 or 5 submission (amendments included) is fetched,
 * archived and parsed into insider rows available one minute after acceptance.
 *
 * - A day with no index (weekends are skipped before HTTP; holidays may answer
 *   404) is not an error.
 * - The index lists a filing once per CIK involved, so entries are reduced to one
 *   per accession.
 * - A submission that cannot be fetched or parsed is reported and left for a
 *   later pass: nothing is written for it, so the next pass sees it as new.
 *
 * This step only returns rows; the job merges them (`insiderLakeMerge.ts`) and
 * publishes.
 */
export interface InsiderRefreshDeps {
  /** A day's form index text, or null when EDGAR published none for that day. */
  fetchDailyIndex(isoDate: string): Promise<string | null>;
  fetchSubmission(entry: EdgarIndexEntry): Promise<{ text: string; url: string }>;
  /** Archive the submission text; returns its archive key. */
  archiveSubmission(entry: EdgarIndexEntry, text: string, url: string): Promise<string>;
}

export interface InsiderRefreshOptions {
  /** YYYY-MM-DD days to read, oldest first. */
  dates: readonly string[];
  /** Accessions already in the insider tables, from either source. */
  knownAccessions: ReadonlySet<string>;
  maxSubmissions: number;
}

export interface InsiderRefreshResult {
  rows: Form345DatasetRows;
  /** Days EDGAR published no index for. */
  unpublishedDays: string[];
  listed: number;
  processed: string[];
  deferred: number;
  failures: string[];
}

export async function refreshInsiderFilings(
  deps: InsiderRefreshDeps,
  options: InsiderRefreshOptions
): Promise<InsiderRefreshResult> {
  const failures: string[] = [];
  const unpublishedDays: string[] = [];
  const byAccession = new Map<string, EdgarIndexEntry>();
  for (const date of options.dates) {
    try {
      const text = await deps.fetchDailyIndex(date);
      if (text === null) {
        unpublishedDays.push(date);
        continue;
      }
      for (const entry of insiderIndexEntries(parseEdgarDailyFormIndex(text))) {
        if (!byAccession.has(entry.accession)) byAccession.set(entry.accession, entry);
      }
    } catch (error) {
      failures.push(`index ${date}: ${describeError(error)}`);
    }
  }

  const pending = [...byAccession.values()].filter((entry) => !options.knownAccessions.has(entry.accession));
  const selected = pending.slice(0, options.maxSubmissions);
  const rows: Form345DatasetRows = { filings: [], transactions: [] };
  const processed: string[] = [];
  for (const entry of selected) {
    processed.push(entry.accession);
    try {
      const { text, url } = await deps.fetchSubmission(entry);
      const archiveKey = await deps.archiveSubmission(entry, text, url);
      const parsed = parseEdgarOwnershipSubmission(text, archiveKey);
      rows.filings.push(...parsed.filings);
      rows.transactions.push(...parsed.transactions);
    } catch (error) {
      failures.push(`${entry.accession}: ${describeError(error)}`);
    }
  }

  return {
    rows,
    unpublishedDays,
    listed: byAccession.size,
    processed,
    deferred: pending.length - selected.length,
    failures,
  };
}
