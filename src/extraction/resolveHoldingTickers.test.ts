import type { ThirteenFDatasetRows, ThirteenFHoldingRow } from "./infoTable";
import { resolveHoldingTickers } from "./resolveHoldingTickers";

function holding(cusip: string): ThirteenFHoldingRow {
  return {
    accession: "A",
    infoTableSk: `${cusip}-1`,
    availableAt: new Date("2025-01-01T00:00:00.000Z"),
    availabilitySource: "test",
    issuerName: null,
    titleOfClass: null,
    cusip,
    figi: null,
    value: 1,
    sharesAmount: 1,
    sharesType: "SH",
    putCall: null,
    discretion: null,
    otherManager: null,
    votingSole: null,
    votingShared: null,
    votingNone: null,
    resolvedTicker: null,
    valueUnitSource: null,
    rawArchiveKey: "test",
  };
}

function dataset(cusips: string[]): ThirteenFDatasetRows {
  return { filings: [], holdings: cusips.map(holding) };
}

describe("resolveHoldingTickers", () => {
  it("stamps the ticker and counts what it could not resolve", () => {
    const rows = dataset(["037833100", "999999999"]);

    const report = resolveHoldingTickers(rows, [{ cusip: "037833100", ticker: "AAPL" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
    expect(rows.holdings[1]!.resolvedTicker).toBeNull();
    expect(report).toEqual({ resolved: 1, unresolved: 1, unresolvedCusips: 1 });
  });

  it("matches regardless of case or padding, because filings are not consistent", () => {
    const rows = dataset([" 037833100 "]);

    resolveHoldingTickers(rows, [{ cusip: "037833100", ticker: "aapl" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
  });

  it("takes the FIRST pair for a CUSIP, so caller order decides a share class", () => {
    // Several tickers on one CUSIP is a share class or a dual listing. The
    // package cannot know which the caller wants; it documents that the first
    // wins rather than picking by sort order.
    const rows = dataset(["037833100"]);

    resolveHoldingTickers(rows, [
      { cusip: "037833100", ticker: "AAPL" },
      { cusip: "037833100", ticker: "AAPL.MX" },
    ]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
  });

  it("counts DISTINCT unresolved CUSIPs, not unresolved rows", () => {
    // A manager holding one unmapped security across ten rows is one gap to
    // chase, not ten.
    const rows = dataset(["999999999", "999999999", "888888888"]);

    const report = resolveHoldingTickers(rows, []);

    expect(report.unresolved).toBe(3);
    expect(report.unresolvedCusips).toBe(2);
  });

  it("clears a stale ticker rather than leaving a previous pass's value", () => {
    const rows = dataset(["999999999"]);
    rows.holdings[0]!.resolvedTicker = "WRONG";

    resolveHoldingTickers(rows, []);

    expect(rows.holdings[0]!.resolvedTicker).toBeNull();
  });
});
