import type { ThirteenFDatasetRows, ThirteenFHoldingRow } from "./infoTable";
import type { CusipTickerPair } from "./cusipTickerCrosswalk";

/**
 * Stamp `resolvedTicker` onto holdings from a CUSIP crosswalk.
 *
 * 13F names a security by CUSIP and nothing else, so a lake built from these
 * filings cannot be joined to prices or screened until something resolves it.
 * Build the crosswalk with `buildCrosswalkFromMembers` over N-PORT, top it up
 * with `OpenFigiClient` for CUSIPs no registered fund holds, and pass the pairs
 * here.
 *
 * A CUSIP with several tickers is a share class or a dual listing. The caller's
 * order decides, and the first pair wins, so pass them in the order you trust.
 * Normalize before passing: a Bloomberg composite (`CCO CN`) must be rejected
 * rather than stripped, because bare `CCO` is a different company in the US.
 * See the README for the measured failure rates.
 */
export interface TickerResolutionReport {
  resolved: number;
  unresolved: number;
  /** Distinct CUSIPs that nothing in the crosswalk covered. */
  unresolvedCusips: number;
}

export function resolveHoldingTickers(
  rows: ThirteenFDatasetRows,
  pairs: Iterable<Pick<CusipTickerPair, "cusip" | "ticker">>,
): TickerResolutionReport {
  const byCusip = new Map<string, string>();
  for (const pair of pairs) {
    const cusip = pair.cusip.trim().toUpperCase();
    if (cusip && pair.ticker && !byCusip.has(cusip)) byCusip.set(cusip, pair.ticker.toUpperCase());
  }

  const report: TickerResolutionReport = { resolved: 0, unresolved: 0, unresolvedCusips: 0 };
  const missing = new Set<string>();
  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    const ticker = byCusip.get(holding.cusip.trim().toUpperCase());
    if (ticker) {
      holding.resolvedTicker = ticker;
      report.resolved += 1;
    } else {
      holding.resolvedTicker = null;
      report.unresolved += 1;
      missing.add(holding.cusip);
    }
  }
  report.unresolvedCusips = missing.size;
  return report;
}
