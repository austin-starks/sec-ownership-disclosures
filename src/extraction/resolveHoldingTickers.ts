import type { ThirteenFDatasetRows, ThirteenFHoldingRow } from "./infoTable";

/**
 * A CUSIP mapped to a ticker, optionally for a span of time.
 *
 * Dates matter because price history is keyed by the ticker as traded ON a
 * date. A security that renamed keeps its old rows under its old symbol, and a
 * reused symbol belongs to a different company before its current holder
 * listed. An undated pair applies to every date, which is only safe when the
 * symbol has never changed hands.
 */
export interface TickerSpan {
  cusip: string;
  ticker: string;
  /** Inclusive ISO date the ticker took effect. Omit for "always". */
  fromDate?: string | null;
  /** Inclusive ISO date it stopped. Null or omitted means it still applies. */
  toDate?: string | null;
}

export interface TickerResolutionReport {
  resolved: number;
  unresolved: number;
  /** Distinct CUSIPs that nothing in the crosswalk covered. */
  unresolvedCusips: number;
  /** Rows whose CUSIP is known but had no span covering the holding's date. */
  outsideEverySpan: number;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function covers(span: TickerSpan, day: string): boolean {
  if (span.fromDate && day < span.fromDate) return false;
  if (span.toDate && day > span.toDate) return false;
  return true;
}

/**
 * Stamp `resolvedTicker` onto holdings from a CUSIP crosswalk.
 *
 * A 13F names a security by CUSIP and nothing else, so a lake built from these
 * filings cannot be joined to prices or screened until something resolves it.
 * Build the crosswalk with `buildCrosswalkFromMembers` over N-PORT, top it up
 * with `OpenFigiClient` for CUSIPs no registered fund holds, and pass the spans
 * here.
 *
 * Each holding is matched on its own `availableAt`, so a 2013 row gets the
 * symbol that security traded under in 2013 rather than today's. Where several
 * spans cover the same day the first wins, so pass them in the order you trust.
 *
 * A CUSIP with no covering span resolves to null. That is deliberate: a wrong
 * ticker joins cleanly to another company's prices and is indistinguishable
 * from correct data downstream, where a null is visible and recoverable.
 */
export function resolveHoldingTickers(
  rows: ThirteenFDatasetRows,
  spans: Iterable<TickerSpan>,
): TickerResolutionReport {
  const byCusip = new Map<string, TickerSpan[]>();
  for (const span of spans) {
    const cusip = span.cusip.trim().toUpperCase();
    const ticker = span.ticker?.trim().toUpperCase();
    if (!cusip || !ticker) continue;
    const list = byCusip.get(cusip) ?? [];
    list.push({ ...span, cusip, ticker });
    byCusip.set(cusip, list);
  }

  const report: TickerResolutionReport = {
    resolved: 0,
    unresolved: 0,
    unresolvedCusips: 0,
    outsideEverySpan: 0,
  };
  const missing = new Set<string>();
  for (const holding of rows.holdings as ThirteenFHoldingRow[]) {
    const cusip = holding.cusip.trim().toUpperCase();
    const list = byCusip.get(cusip);
    const match = list?.find((span) => covers(span, isoDay(holding.availableAt)));
    if (match) {
      holding.resolvedTicker = match.ticker;
      report.resolved += 1;
      continue;
    }
    holding.resolvedTicker = null;
    report.unresolved += 1;
    if (list) report.outsideEverySpan += 1;
    else missing.add(cusip);
  }
  report.unresolvedCusips = missing.size;
  return report;
}
