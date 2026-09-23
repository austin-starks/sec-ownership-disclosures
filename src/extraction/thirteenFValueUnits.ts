import type {
  ThirteenFDatasetRows,
  ThirteenFFilingRow,
  ThirteenFHoldingRow,
} from "./infoTable";

/**
 * 13F `value` is reported in two units and the column does not say which: SEC's
 * 2022 amendments switched the information table from thousands of USD to whole
 * USD for filings from 2023-01-01, so summing across the history adds both.
 *
 * The date is a PRIOR, not a verdict — filers disobey it in both directions at
 * scale (4.4% of rows when measured). A filing is internally consistent, so its
 * own median implied price decides, and the date only breaks ties it cannot.
 *
 * Detail and the measurements: designs/2026-09-23-institutional-holdings-ticker-resolution.md
 */

/** Filings from this date report whole dollars; earlier ones report thousands. */
export const THIRTEEN_F_DOLLARS_FROM = "2023-01-01";
const THOUSANDS_TO_DOLLARS = 1000;

export interface ValueNormalizationReport {
  /** Rows scaled from thousands to dollars. */
  scaled: number;
  /** Rows already in dollars, left alone. */
  untouched: number;
  /** No filing row for the accession, so no date to judge by. Left unscaled. */
  unresolvedFilingDate: number;
  /** Filings whose own numbers contradicted their date. Printed on publish. */
  overrodeDate: number;
  /** Too few share rows to judge; the date decided. */
  decidedByDateAlone: number;
}

/** A median holding over $5,000/share cannot be a thousands filing. */
const IMPLAUSIBLE_IF_THOUSANDS = 5;
/** A median holding under $0.50/share cannot be a dollars filing. */
const IMPLAUSIBLE_IF_DOLLARS = 0.5;
const MIN_ROWS_TO_JUDGE = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lexical comparison, so a non-ISO date throws rather than being guessed at:
 * `"12/31/2022"` sorts after `"2023-01-01"` and would silently go unscaled.
 */
export function reportsValueInThousands(filingDate: string | null | undefined): boolean {
  if (!filingDate) return false;
  const day = filingDate.slice(0, 10);
  if (!ISO_DATE.test(day)) {
    throw new Error(`filingDate is not ISO (YYYY-MM-DD), refusing to guess its unit: ${filingDate}`);
  }
  return day < THIRTEEN_F_DOLLARS_FROM;
}

function filingDatesByAccession(filings: readonly ThirteenFFilingRow[]): Map<string, string> {
  const byAccession = new Map<string, string>();
  for (const filing of filings) {
    if (!byAccession.has(filing.accession)) byAccession.set(filing.accession, filing.filingDate);
  }
  return byAccession;
}

/**
 * Rewrite `value` to whole dollars in place, for a freshly parsed dataset.
 *
 * NOT idempotent: a second pass scales by a million. Call it once per parse of
 * a raw archive, never against rows read back from a published shard — which is
 * why the repair republish uses `--rebuild` instead of merging.
 */
export function normalizeThirteenFValuesToDollars(
  rows: ThirteenFDatasetRows,
): ValueNormalizationReport {
  const filingDates = filingDatesByAccession(rows.filings);
  const report: ValueNormalizationReport = {
    scaled: 0,
    untouched: 0,
    unresolvedFilingDate: 0,
    overrodeDate: 0,
    decidedByDateAlone: 0,
  };

  // Only ordinary share rows: a principal amount or a contract count is not a
  // share count and would poison the median.
  const impliedPrices = new Map<string, number[]>();
  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    if (holding.sharesType !== "SH") continue;
    if (holding.putCall) continue;
    if (!holding.value || !holding.sharesAmount || holding.sharesAmount <= 0) continue;
    const prices = impliedPrices.get(holding.accession) ?? [];
    prices.push(holding.value / holding.sharesAmount);
    impliedPrices.set(holding.accession, prices);
  }

  const scaleByAccession = new Map<string, boolean>();
  for (const [accession, filingDate] of filingDates) {
    const byDate = reportsValueInThousands(filingDate);
    const prices = impliedPrices.get(accession) ?? [];
    const implied = prices.length >= MIN_ROWS_TO_JUDGE ? median(prices) : null;

    if (implied === null) {
      report.decidedByDateAlone += 1;
      scaleByAccession.set(accession, byDate);
      continue;
    }
    // The data speaks only when the date's answer would be absurd.
    const contradicted = byDate
      ? implied > IMPLAUSIBLE_IF_THOUSANDS
      : implied < IMPLAUSIBLE_IF_DOLLARS;
    if (contradicted) report.overrodeDate += 1;
    scaleByAccession.set(accession, contradicted ? !byDate : byDate);
  }

  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    if (holding.value === null || holding.value === undefined) continue;
    const scale = scaleByAccession.get(holding.accession);
    if (scale === undefined) {
      report.unresolvedFilingDate += 1;
      continue;
    }
    if (scale) {
      holding.value = holding.value * THOUSANDS_TO_DOLLARS;
      report.scaled += 1;
    } else {
      report.untouched += 1;
    }
  }
  return report;
}
