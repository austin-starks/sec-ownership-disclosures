import type {
  ThirteenFDatasetRows,
  ThirteenFFilingRow,
  ThirteenFHoldingRow,
} from "./infoTable";

/**
 * 13F `value` is reported in TWO different units and the column does not say
 * which.
 *
 * SEC's 2022 Form 13F amendments changed the information table from reporting
 * value in thousands of dollars to whole dollars. The filings themselves carry
 * no unit field, so a naive `SUM(value)` over the full history adds thousands
 * to dollars and inflates everything from 2023 onward by 1000x against
 * everything before it.
 *
 * **Measured 2026-09-23** as median implied price per share
 * (`value / sharesAmount`, SH rows, no option leg), which is only plausible
 * under one convention at a time:
 *
 * ```
 * by filingDate      by periodOfReport
 * 2022-11   0.0478     2022-09   0.0559   <- thousands
 * 2022-12   0.0773     2022-12  37.8185   <- DOLLARS, one quarter early
 * 2023-01  36.9710     2023-03  43.5844
 * ```
 *
 * **The date keys on `filingDate`, not `periodOfReport`.** Q4-2022 holdings were
 * filed in January and February 2023 under the new rule, so a period-keyed
 * cutover mis-scales an entire quarter.
 *
 * **But the date is a PRIOR, not a verdict — filers disobey it in both
 * directions, at scale.** Measured against the lake on 2026-09-23, after a
 * republish that trusted the date alone:
 *
 * ```
 * pre-2023 filings already in dollars     3,232 filings   1,644,310 rows
 * post-2023 filings still in thousands    9,802 filings   3,769,157 rows
 * ```
 *
 * That is 4.4% of the table, and the largest single offender is UBS Asset
 * Management, filing in dollars since at least 2019 with 19,002 rows in one
 * report. A date-only rule inflated those by 1000x — Berkshire A landed at an
 * implied $170,400,000 a share.
 *
 * **So the filing decides its own unit.** A 13F report is internally
 * consistent: one manager, one convention, hundreds of rows. Its median
 * implied price separates the hypotheses by three orders of magnitude:
 *
 * ```
 * thousands -> value/shares ~ 0.05
 * dollars   -> value/shares ~ 50
 * ```
 *
 * The data overrides the date only when the date's answer would be absurd, so
 * an ordinary filing is never second-guessed, and every override is counted.
 *
 * A PER-ROW test does not work and must not be reintroduced: `value/shares < 1`
 * also catches every penny stock. The discriminator is the filing's median, not
 * any single holding.
 *
 * `value` on the parsed row stays exactly as the filing reported it, because
 * mirroring the source is this package's job. Normalization is offered as a
 * function so a consumer building a queryable table applies it once and says
 * so, rather than each consumer rediscovering the break.
 */

/** Filings from this date report whole dollars; earlier ones report thousands. */
export const THIRTEEN_F_DOLLARS_FROM = "2023-01-01";
const THOUSANDS_TO_DOLLARS = 1000;

export interface ValueNormalizationReport {
  /** Rows scaled from thousands to dollars. */
  scaled: number;
  /** Rows already in dollars, left alone. */
  untouched: number;
  /**
   * Holdings whose accession had no filing row in the same dataset, so no
   * filing date was available. Left unscaled and counted rather than guessed
   * at — a wrongly scaled row is worse than a flagged one.
   */
  unresolvedFilingDate: number;
  /**
   * Filings whose own numbers contradicted their filing date, so the data won.
   * Printed on every publish: a silent override is how a 1000x rule drifts.
   */
  overrodeDate: number;
  /** Filings with too few share rows to judge, decided by date alone. */
  decidedByDateAlone: number;
}

/**
 * Median implied price above which a filing cannot be in thousands: it would
 * mean a median holding over $5,000 a share, which only Berkshire A reaches.
 */
const IMPLAUSIBLE_IF_THOUSANDS = 5;
/**
 * Median implied price below which a filing cannot be in dollars: a median
 * holding under $0.50 a share across a whole 13F report.
 */
const IMPLAUSIBLE_IF_DOLLARS = 0.5;
/** Fewer share rows than this and the median is not worth trusting. */
const MIN_ROWS_TO_JUDGE = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when a filing of this date reported value in thousands.
 *
 * The comparison is lexical, which is correct for ISO dates and silently wrong
 * for anything else: `"12/31/2022"` sorts AFTER `"2023-01-01"`, so a
 * pre-cutover filing would go unscaled and its value would be understated
 * 1000x with nothing on screen to show for it. A non-ISO date therefore throws
 * rather than being guessed at — the 2026-09-23 republish proved the source is
 * ISO (every pre-2023 window scaled 100%, every later one 0%), and this keeps
 * that true if the upstream format ever moves.
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
    // An amendment and its original share neither accession nor date, so the
    // first writer wins only among genuine duplicates.
    if (!byAccession.has(filing.accession)) byAccession.set(filing.accession, filing.filingDate);
  }
  return byAccession;
}

/**
 * Rewrite `value` to whole dollars, in place, for a freshly parsed dataset.
 *
 * **Not idempotent, deliberately.** Applying it twice scales by a million, so
 * it is called exactly once per parse of a raw archive and never against rows
 * read back from a published shard. The republish that fixes history must
 * therefore rebuild years from the raw archives rather than merging with the
 * already-published generation.
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

  // One pass to gather each filing's own evidence. Only ordinary share rows
  // count: a principal amount or an option contract count is not a share
  // count, and mixing them in would poison the median.
  const impliedPrices = new Map<string, number[]>();
  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    if (holding.sharesType !== "SH") continue;
    if (holding.putCall) continue;
    if (!holding.value || !holding.sharesAmount || holding.sharesAmount <= 0) continue;
    const prices = impliedPrices.get(holding.accession) ?? [];
    prices.push(holding.value / holding.sharesAmount);
    impliedPrices.set(holding.accession, prices);
  }

  // Then one decision per filing, not per row.
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
