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
 * **The rule keys on `filingDate`, not `periodOfReport`.** Q4-2022 holdings
 * were filed in January and February 2023 under the new rule, so a
 * period-keyed cutover mis-scales an entire quarter by 1000x. Every filing
 * month through 2022-12 reads as thousands and every month from 2023-01 reads
 * as dollars, with no mixed month.
 *
 * A per-row test does NOT work and must not be reintroduced: `value/shares < 1`
 * also catches every penny stock, and `>= 1` under the thousands convention
 * catches anything over $1,000 a share. That is price dispersion, not unit
 * mixing. The filing date is the only clean discriminator.
 *
 * `value` on the parsed row stays exactly as the filing reported it, because
 * this package's job is to mirror the source. Normalization is offered as a
 * function so a consumer building a queryable table can apply it once and say
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
}

/** True when a filing of this date reported value in thousands. */
export function reportsValueInThousands(filingDate: string | null | undefined): boolean {
  if (!filingDate) return false;
  // ISO dates compare correctly as strings; the source writes YYYY-MM-DD.
  return filingDate.slice(0, 10) < THIRTEEN_F_DOLLARS_FROM;
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
  const byAccession = filingDatesByAccession(rows.filings);
  const report: ValueNormalizationReport = { scaled: 0, untouched: 0, unresolvedFilingDate: 0 };

  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    if (holding.value === null || holding.value === undefined) continue;
    const filingDate = byAccession.get(holding.accession);
    if (!filingDate) {
      report.unresolvedFilingDate += 1;
      continue;
    }
    if (reportsValueInThousands(filingDate)) {
      holding.value = holding.value * THOUSANDS_TO_DOLLARS;
      report.scaled += 1;
    } else {
      report.untouched += 1;
    }
  }
  return report;
}
