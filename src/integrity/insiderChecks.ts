import type { Form345DatasetRows } from "../extraction/form345Dataset";

/**
 * Per-window integrity over parsed Form 3/4/5 rows. Pure: no store, no
 * network. Cross-quarter questions (disjointness, amendment originals) are
 * answered by the runner from these aggregates plus filing-date boundaries,
 * not by holding all rows in memory.
 */
export interface InsiderWindowIntegrity {
  label: string;
  filings: number;
  accessions: number;
  /** accession × owner key seen more than once (capped). */
  duplicateFilingKeys: string[];
  /** transactions whose accession has no filing in this window (should be 0; parser enforces). */
  orphanTransactions: number;
  /** transactionCode inventory — unknown codes surface here, not in a log. */
  transactionCodes: Record<string, number>;
  /** transactionDate after the filing's filingDate. */
  futureDatedTransactions: number;
  /** share of transactions with no issuer ticker. */
  nullTickerTransactions: number;
  /** share of transactions with null shares. */
  nullSharesTransactions: number;
  /** negative share or price values (should be 0). */
  negativeAmounts: number;
  /** amendments (X/A) carrying no original-submission date. */
  amendmentsWithoutOriginalDate: number;
  /** min/max filingDate in the window (boundary disjointness input). */
  filingDateRange: { min: string | null; max: string | null };
  /** accessions in this window (for cross-window overlap accounting). */
  windowAccessions: string[];
}

const SAMPLE_CAP = 20;

export function checkInsiderWindow(label: string, rows: Form345DatasetRows): InsiderWindowIntegrity {
  const filingByAccession = new Map<string, (typeof rows.filings)[number][]>();
  for (const filing of rows.filings) {
    const list = filingByAccession.get(filing.accession) ?? [];
    list.push(filing);
    filingByAccession.set(filing.accession, list);
  }
  const seenKeys = new Set<string>();
  const duplicateFilingKeys: string[] = [];
  for (const [accession, filings] of filingByAccession) {
    const owners = new Set(filings.map((f) => f.ownerCik));
    if (owners.size < filings.length) {
      const key = `${accession} x${filings.length - owners.size + 1}`;
      if (!seenKeys.has(key) && duplicateFilingKeys.length < SAMPLE_CAP) {
        seenKeys.add(key);
        duplicateFilingKeys.push(key);
      }
    }
  }
  const filingDateByAccession = new Map<string, string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const filing of rows.filings) {
    if (!filingDateByAccession.has(filing.accession)) filingDateByAccession.set(filing.accession, filing.filingDate);
    if (minDate === null || filing.filingDate < minDate) minDate = filing.filingDate;
    if (maxDate === null || filing.filingDate > maxDate) maxDate = filing.filingDate;
  }
  let orphanTransactions = 0;
  let futureDatedTransactions = 0;
  let nullTickerTransactions = 0;
  let nullSharesTransactions = 0;
  let negativeAmounts = 0;
  const transactionCodes: Record<string, number> = {};
  for (const tx of rows.transactions) {
    const filingDate = filingDateByAccession.get(tx.accession);
    if (!filingDate) {
      orphanTransactions += 1;
      continue;
    }
    const code = tx.transactionCode ?? "NULL";
    transactionCodes[code] = (transactionCodes[code] ?? 0) + 1;
    if (tx.transactionDate && tx.transactionDate > filingDate) futureDatedTransactions += 1;
    if (!tx.issuerTicker) nullTickerTransactions += 1;
    if (tx.shares === null) nullSharesTransactions += 1;
    if ((tx.shares ?? 0) < 0 || (tx.pricePerShare ?? 0) < 0) negativeAmounts += 1;
  }
  let amendmentsWithoutOriginalDate = 0;
  for (const filing of rows.filings) {
    if (filing.formType.endsWith("/A") && !filing.dateOfOriginalSubmission) amendmentsWithoutOriginalDate += 1;
  }
  return {
    label,
    filings: rows.filings.length,
    accessions: filingByAccession.size,
    duplicateFilingKeys,
    orphanTransactions,
    transactionCodes,
    futureDatedTransactions,
    nullTickerTransactions,
    nullSharesTransactions,
    negativeAmounts,
    amendmentsWithoutOriginalDate,
    filingDateRange: { min: minDate, max: maxDate },
    windowAccessions: [...filingByAccession.keys()],
  };
}
