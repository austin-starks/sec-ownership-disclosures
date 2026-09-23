import type { InsiderFilingRow, InsiderTransactionRow } from "../extraction/form345Dataset";

/**
 * Physical shape of the two insider lake tables. Each column map is keyed by the
 * row interface itself, so adding a field to a row without giving it a column
 * type (or leaving a stale column behind) fails to compile. Key order is the
 * Parquet column order.
 *
 * Shards are yearly on the UTC year of `availableAt`, the point-in-time column,
 * never on transaction or filing dates.
 */
export const INSIDER_FILINGS_PREFIX = "insider_filings";
export const INSIDER_TRANSACTIONS_PREFIX = "insider_transactions";

export const INSIDER_FILINGS_COLUMNS: Readonly<Record<keyof InsiderFilingRow, string>> = {
  accession: "VARCHAR",
  formType: "VARCHAR",
  filingDate: "DATE",
  availableAt: "TIMESTAMP",
  availabilitySource: "VARCHAR",
  periodOfReport: "DATE",
  dateOfOriginalSubmission: "DATE",
  issuerCik: "VARCHAR",
  issuerName: "VARCHAR",
  issuerTicker: "VARCHAR",
  ownerCik: "VARCHAR",
  ownerName: "VARCHAR",
  isDirector: "BOOLEAN",
  isOfficer: "BOOLEAN",
  isTenPercentOwner: "BOOLEAN",
  isOther: "BOOLEAN",
  officerTitle: "VARCHAR",
  ownerRelationshipText: "VARCHAR",
  aff10b5One: "BOOLEAN",
  rawArchiveKey: "VARCHAR",
};

export const INSIDER_TRANSACTIONS_COLUMNS: Readonly<Record<keyof InsiderTransactionRow, string>> = {
  accession: "VARCHAR",
  rowKind: "VARCHAR",
  rowSk: "VARCHAR",
  formType: "VARCHAR",
  issuerCik: "VARCHAR",
  issuerTicker: "VARCHAR",
  availableAt: "TIMESTAMP",
  availabilitySource: "VARCHAR",
  securityTitle: "VARCHAR",
  transactionDate: "DATE",
  deemedExecutionDate: "DATE",
  transactionFormType: "VARCHAR",
  transactionCode: "VARCHAR",
  equitySwapInvolved: "BOOLEAN",
  acquiredDisposed: "VARCHAR",
  shares: "DOUBLE",
  pricePerShare: "DOUBLE",
  totalValue: "DOUBLE",
  sharesOwnedFollowing: "DOUBLE",
  directIndirect: "VARCHAR",
  natureOfOwnership: "VARCHAR",
  exercisePrice: "DOUBLE",
  exerciseDate: "DATE",
  expirationDate: "DATE",
  underlyingTitle: "VARCHAR",
  underlyingShares: "DOUBLE",
  rawArchiveKey: "VARCHAR",
};

export const INSIDER_ORDER_BY = "issuerTicker, availableAt";

export function availableYear(row: { availableAt: Date }): number {
  return row.availableAt.getUTCFullYear();
}

/** Rows grouped by the UTC year of `availableAt`, years ascending. */
export function bucketByAvailableYear<T extends { availableAt: Date }>(
  rows: readonly T[]
): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  for (const row of rows) {
    const year = availableYear(row);
    const bucket = buckets.get(year) ?? [];
    bucket.push(row);
    buckets.set(year, bucket);
  }
  return new Map([...buckets.entries()].sort(([left], [right]) => left - right));
}

export function toParquetRow<T extends object>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row));
}
