import { mergeHoldingsRows } from "./holdingsMerge";
import type { ThirteenFDatasetRows } from "../extraction/infoTable";

const EMPTY: ThirteenFDatasetRows = { filings: [], holdings: [] };

describe("mergeHoldingsRows", () => {
  it("dedupes a republished window and keeps both vintages", () => {
    const window = {
      filings: [
        {
          accession: "a1", filingDate: "2026-03-31", availableAt: new Date("2026-04-01T03:59:59.999Z"),
          availabilitySource: "sec_13f_quarterly_dataset", submissionType: "13F-HR", cik: "c1",
          managerName: "M", periodOfReport: "2025-12-31", reportCalendarOrQuarter: null,
          isAmendment: false, amendmentNo: null, amendmentType: null, dateReported: null, rawArchiveKey: "k",
        },
      ],
      holdings: [
        {
          accession: "a1", infoTableSk: "1", availableAt: new Date("2026-04-01T03:59:59.999Z"),
          availabilitySource: "sec_13f_quarterly_dataset", issuerName: "X", titleOfClass: "COM",
          cusip: "111", figi: null, value: 1, sharesAmount: 1, sharesType: "SH", putCall: null,
          discretion: "SOLE", otherManager: null, votingSole: 1, votingShared: 0, votingNone: 0,
          resolvedTicker: null, valueUnitSource: null, rawArchiveKey: "k",
        },
      ],
    };
    const once = mergeHoldingsRows(EMPTY, window);
    const twice = mergeHoldingsRows(once, window);
    expect(twice.filings).toHaveLength(1);
    expect(twice.holdings).toHaveLength(1);
    expect(mergeHoldingsRows(EMPTY, { filings: [], holdings: [] })).toEqual(EMPTY);
  });

  it("rejects rows from an unknown source", () => {
    const foreign = {
      filings: [],
      holdings: [],
    };
    expect(() =>
      mergeHoldingsRows(EMPTY, {
        filings: [
          {
            accession: "a2", filingDate: "2026-03-31", availableAt: new Date(),
            availabilitySource: "elsewhere", submissionType: "13F-HR", cik: "c1",
            managerName: null, periodOfReport: null, reportCalendarOrQuarter: null,
            isAmendment: null, amendmentNo: null, amendmentType: null, dateReported: null, rawArchiveKey: "k",
          },
        ],
        holdings: foreign.holdings,
      })
    ).toThrow('Unknown holdings availability source "elsewhere"');
  });
});
