import type { ThirteenFFilingRow, ThirteenFHoldingRow } from "../extraction/infoTable";

/**
 * Physical shape of the two institutional lake tables. Each column map is
 * keyed by the row interface itself, so adding a field to a row without
 * giving it a column type (or leaving a stale column behind) fails to
 * compile. Key order is the Parquet column order.
 *
 * Shards are yearly on the UTC year of `availableAt`, the point-in-time
 * column, never on the report period. A 13F filed in February about the
 * December quarter belongs to the filing year: it measures what the manager
 * held with a lag of up to 45 days, never entry timing.
 */
export const THIRTEEN_F_FILINGS_PREFIX = "institutional_filings";
export const THIRTEEN_F_HOLDINGS_PREFIX = "institutional_holdings";

export const THIRTEEN_F_FILINGS_COLUMNS: Readonly<Record<keyof ThirteenFFilingRow, string>> = {
  accession: "VARCHAR",
  filingDate: "DATE",
  availableAt: "TIMESTAMP",
  availabilitySource: "VARCHAR",
  submissionType: "VARCHAR",
  cik: "VARCHAR",
  managerName: "VARCHAR",
  periodOfReport: "DATE",
  reportCalendarOrQuarter: "VARCHAR",
  isAmendment: "BOOLEAN",
  amendmentNo: "VARCHAR",
  amendmentType: "VARCHAR",
  dateReported: "DATE",
  rawArchiveKey: "VARCHAR",
};

export const THIRTEEN_F_HOLDINGS_COLUMNS: Readonly<Record<keyof ThirteenFHoldingRow, string>> = {
  accession: "VARCHAR",
  infoTableSk: "VARCHAR",
  availableAt: "TIMESTAMP",
  availabilitySource: "VARCHAR",
  issuerName: "VARCHAR",
  titleOfClass: "VARCHAR",
  cusip: "VARCHAR",
  figi: "VARCHAR",
  value: "DOUBLE",
  sharesAmount: "DOUBLE",
  sharesType: "VARCHAR",
  putCall: "VARCHAR",
  discretion: "VARCHAR",
  otherManager: "VARCHAR",
  votingSole: "DOUBLE",
  votingShared: "DOUBLE",
  votingNone: "DOUBLE",
  resolvedTicker: "VARCHAR",
  valueUnitSource: "VARCHAR",
  rawArchiveKey: "VARCHAR",
};

export const THIRTEEN_F_FILINGS_ORDER_BY = "accession, availableAt";
export const THIRTEEN_F_HOLDINGS_ORDER_BY = "cusip, availableAt";
