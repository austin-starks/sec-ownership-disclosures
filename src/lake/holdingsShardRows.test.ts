import { toParquetRow } from "./insiderLakeTables";
import { institutionalFilingFromShard, institutionalHoldingFromShard } from "./holdingsShardRows";
import type { ThirteenFFilingRow, ThirteenFHoldingRow } from "../extraction/infoTable";

const FILING: ThirteenFFilingRow = {
  accession: "0001-26-000001",
  filingDate: "2026-03-31",
  availableAt: new Date("2026-04-01T03:59:59.999Z"),
  availabilitySource: "s",
  submissionType: "13F-HR",
  cik: "0001234567",
  managerName: null,
  periodOfReport: "2025-12-31",
  reportCalendarOrQuarter: null,
  isAmendment: false,
  amendmentNo: null,
  amendmentType: null,
  dateReported: null,
  rawArchiveKey: "k",
};

const HOLDING: ThirteenFHoldingRow = {
  accession: "0001-26-000001",
  infoTableSk: "10",
  availableAt: new Date("2026-04-01T03:59:59.999Z"),
  availabilitySource: "s",
  issuerName: null,
  titleOfClass: "COM",
  cusip: "000000000",
  figi: null,
  value: 0,
  sharesAmount: 0,
  sharesType: "SH",
  putCall: null,
  discretion: "SOLE",
  otherManager: null,
  votingSole: 0,
  votingShared: 0,
  votingNone: 0,
  resolvedTicker: null,
  valueUnitSource: null,
  rawArchiveKey: "k",
};

describe("holdings shard rows", () => {
  it("round-trips filings and placeholder holdings", () => {
    expect(institutionalFilingFromShard(toParquetRow(FILING))).toEqual(FILING);
    expect(institutionalHoldingFromShard(toParquetRow(HOLDING))).toEqual(HOLDING);
  });
});
