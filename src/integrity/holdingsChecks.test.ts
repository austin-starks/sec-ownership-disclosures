import { checkHoldingsWindow } from "./holdingsChecks";
import type { ThirteenFDatasetRows, ThirteenFFilingRow, ThirteenFHoldingRow } from "../extraction/infoTable";

function filing(overrides: Partial<ThirteenFFilingRow> = {}): ThirteenFFilingRow {
  return {
    accession: "0001-26-000001",
    filingDate: "2026-03-31",
    availableAt: new Date("2026-04-01T03:59:59.999Z"),
    availabilitySource: "s",
    submissionType: "13F-HR",
    cik: "0001234567",
    managerName: "Example Capital LP",
    periodOfReport: "2025-12-31",
    reportCalendarOrQuarter: "2025-12-31",
    isAmendment: false,
    amendmentNo: null,
    amendmentType: null,
    dateReported: null,
    rawArchiveKey: "k",
    ...overrides,
  };
}

function holding(overrides: Partial<ThirteenFHoldingRow> = {}): ThirteenFHoldingRow {
  return {
    accession: "0001-26-000001",
    infoTableSk: "10",
    availableAt: new Date("2026-04-01T03:59:59.999Z"),
    availabilitySource: "s",
    issuerName: "Example Corp",
    titleOfClass: "COM",
    cusip: "123456789",
    figi: null,
    value: 1392,
    sharesAmount: 6864,
    sharesType: "SH",
    putCall: null,
    discretion: "SOLE",
    otherManager: null,
    votingSole: 6864,
    votingShared: 0,
    votingNone: 0,
    resolvedTicker: null,
    valueUnitSource: null,
    rawArchiveKey: "k",
    ...overrides,
  };
}

describe("checkHoldingsWindow", () => {
  it("clears a clean window and flags the failure classes", () => {
    const rows: ThirteenFDatasetRows = {
      filings: [
        filing(),
        filing({ accession: "0001-26-000002", submissionType: "13F-NT", managerName: null }),
        filing({ accession: "0001-26-000003", submissionType: "13F-HR/A", isAmendment: true }),
      ],
      holdings: [
        holding(),
        holding({ infoTableSk: "10" }),
        holding({ accession: "9999", infoTableSk: "1" }),
        holding({ infoTableSk: "11", issuerName: null, cusip: "000000000", value: 0, sharesAmount: 0, figi: "BBG1" }),
      ],
    };
    const report = checkHoldingsWindow("w", rows);
    expect(report.filings).toBe(3);
    expect(report.holdings).toBe(4);
    expect(report.duplicateHoldingKeys).toHaveLength(1);
    expect(report.orphanHoldings).toBe(1);
    expect(report.nullIssuerHoldings).toBe(1);
    expect(report.zeroPositionHoldings).toBe(1);
    expect(report.placeholderCusips).toBe(1);
    expect(report.figiCoverage).toBe(1);
    expect(report.nullManagerFilings).toBe(1);
    expect(report.submissionTypes).toMatchObject({ "13F-HR": 1, "13F-NT": 1, "13F-HR/A": 1 });
    expect(report.filingLagDays.p50).toBe(90);
  });

  it("flags notice filings carrying holdings", () => {
    const rows: ThirteenFDatasetRows = {
      filings: [filing({ accession: "0001-26-000002", submissionType: "13F-NT" })],
      holdings: [holding({ accession: "0001-26-000002" })],
    };
    expect(checkHoldingsWindow("w", rows).noticeFilingsWithHoldings).toBe(1);
  });
});
