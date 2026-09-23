import type { ThirteenFDatasetRows } from "../extraction/infoTable";

/**
 * Per-window integrity over parsed 13F rows. Pure: no store, no network.
 * Structural overlap (classic quarters vs shifted acceptance windows) is
 * expected — the runner accounts it by accession union, never by assuming
 * disjointness.
 */
export interface HoldingsWindowIntegrity {
  label: string;
  filings: number;
  holdings: number;
  distinctCusips: number;
  /** accession + INFOTABLE_SK seen more than once (capped; should be empty). */
  duplicateHoldingKeys: string[];
  /** holdings whose accession has no filing in this window (should be 0). */
  orphanHoldings: number;
  /** submissionType inventory. */
  submissionTypes: Record<string, number>;
  /** 13F-NT filings carrying holdings (NT = notice, expects none). */
  noticeFilingsWithHoldings: number;
  /** filings with no manager name. */
  nullManagerFilings: number;
  /** holdings with null issuer name (placeholder rows included). */
  nullIssuerHoldings: number;
  /** zero-value AND zero-share rows (placeholder/confidential-omission shape). */
  zeroPositionHoldings: number;
  /** CUSIP exactly 000000000. */
  placeholderCusips: number;
  /** share with a FIGI (the CUSIP-mapping workload is the complement). */
  figiCoverage: number;
  /** put/call breakdown. */
  putCall: Record<string, number>;
  /** days filed-after-period P50/P95/max (the 45-day rule, measured). */
  filingLagDays: { p50: number | null; p95: number | null; max: number | null };
  accessions: string[];
}

const SAMPLE_CAP = 20;

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

export function checkHoldingsWindow(label: string, rows: ThirteenFDatasetRows): HoldingsWindowIntegrity {
  const filingByAccession = new Map<string, (typeof rows.filings)[number]>();
  for (const filing of rows.filings) {
    if (!filingByAccession.has(filing.accession)) filingByAccession.set(filing.accession, filing);
  }
  const seenHoldings = new Set<string>();
  const duplicateHoldingKeys: string[] = [];
  const cusips = new Set<string>();
  let orphanHoldings = 0;
  let nullIssuerHoldings = 0;
  let zeroPositionHoldings = 0;
  let placeholderCusips = 0;
  let figiCoverage = 0;
  const putCall: Record<string, number> = {};
  for (const holding of rows.holdings) {
    if (!filingByAccession.has(holding.accession)) {
      orphanHoldings += 1;
      continue;
    }
    const key = `${holding.accession}/${holding.infoTableSk}`;
    if (seenHoldings.has(key)) {
      if (duplicateHoldingKeys.length < SAMPLE_CAP) duplicateHoldingKeys.push(key);
    } else {
      seenHoldings.add(key);
    }
    cusips.add(holding.cusip);
    if (!holding.issuerName) nullIssuerHoldings += 1;
    if ((holding.value ?? 0) === 0 && (holding.sharesAmount ?? 0) === 0) zeroPositionHoldings += 1;
    if (holding.cusip === "000000000") placeholderCusips += 1;
    if (holding.figi) figiCoverage += 1;
    const pc = holding.putCall ?? "NULL";
    putCall[pc] = (putCall[pc] ?? 0) + 1;
  }
  const submissionTypes: Record<string, number> = {};
  const holdingsByAccession = new Map<string, number>();
  for (const holding of rows.holdings) {
    holdingsByAccession.set(holding.accession, (holdingsByAccession.get(holding.accession) ?? 0) + 1);
  }
  let noticeFilingsWithHoldings = 0;
  let nullManagerFilings = 0;
  const lags: number[] = [];
  for (const filing of rows.filings) {
    submissionTypes[filing.submissionType] = (submissionTypes[filing.submissionType] ?? 0) + 1;
    if (filing.submissionType.startsWith("13F-NT") && (holdingsByAccession.get(filing.accession) ?? 0) > 0) {
      noticeFilingsWithHoldings += 1;
    }
    if (!filing.managerName) nullManagerFilings += 1;
    if (filing.periodOfReport) {
      const lag = Math.round(
        (new Date(`${filing.filingDate}T00:00:00Z`).getTime() - new Date(`${filing.periodOfReport}T00:00:00Z`).getTime()) / 86400000
      );
      if (Number.isFinite(lag)) lags.push(lag);
    }
  }
  lags.sort((a, b) => a - b);
  return {
    label,
    filings: rows.filings.length,
    holdings: rows.holdings.length,
    distinctCusips: cusips.size,
    duplicateHoldingKeys,
    orphanHoldings,
    submissionTypes,
    noticeFilingsWithHoldings,
    nullManagerFilings,
    nullIssuerHoldings,
    zeroPositionHoldings,
    placeholderCusips,
    figiCoverage,
    putCall,
    filingLagDays: { p50: quantile(lags, 0.5), p95: quantile(lags, 0.95), max: quantile(lags, 1) },
    accessions: [...filingByAccession.keys()],
  };
}
