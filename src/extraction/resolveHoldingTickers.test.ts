import type { ThirteenFDatasetRows, ThirteenFHoldingRow } from "./infoTable";
import { resolveHoldingTickers } from "./resolveHoldingTickers";

function holding(cusip: string, availableAt: string): ThirteenFHoldingRow {
  return {
    accession: "A",
    infoTableSk: `${cusip}-${availableAt}`,
    availableAt: new Date(`${availableAt}T00:00:00.000Z`),
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

function dataset(holdings: ThirteenFHoldingRow[]): ThirteenFDatasetRows {
  return { filings: [], holdings };
}

describe("resolveHoldingTickers", () => {
  it("stamps the ticker and counts what it could not resolve", () => {
    const rows = dataset([holding("037833100", "2025-02-14"), holding("999999999", "2025-02-14")]);

    const report = resolveHoldingTickers(rows, [{ cusip: "037833100", ticker: "AAPL" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
    expect(rows.holdings[1]!.resolvedTicker).toBeNull();
    expect(report).toEqual({ resolved: 1, unresolved: 1, unresolvedCusips: 1, outsideEverySpan: 0 });
  });

  it("matches a CUSIP regardless of case or padding, because filings are not consistent", () => {
    const rows = dataset([holding(" 037833100 ", "2025-02-14")]);

    resolveHoldingTickers(rows, [{ cusip: " 037833100 ", ticker: "AAPL" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
  });

  it("preserves ticker case, because the trailing letter is the share class", () => {
    // `MTLp` is Mechel's preferred ADS and `WRKw` is a when-issued line.
    // Uppercasing either collapses it onto the common stock, which then
    // prices as a different instrument.
    const rows = dataset([holding("583840509", "2015-08-14")]);

    resolveHoldingTickers(rows, [{ cusip: "583840509", ticker: "MTLp" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("MTLp");
  });

  it("gives a row the symbol its security traded under ON ITS OWN DATE", () => {
    // The whole reason spans exist: Facebook is FB until 2022-06-09 and META
    // after. A 2013 row stamped META joins to nothing.
    const spans = [
      { cusip: "30303M102", ticker: "FB", fromDate: "2012-05-18", toDate: "2022-06-08" },
      { cusip: "30303M102", ticker: "META", fromDate: "2022-06-09", toDate: null },
    ];
    const rows = dataset([holding("30303M102", "2013-08-14"), holding("30303M102", "2024-02-14")]);

    resolveHoldingTickers(rows, spans);

    expect(rows.holdings[0]!.resolvedTicker).toBe("FB");
    expect(rows.holdings[1]!.resolvedTicker).toBe("META");
  });

  it("resolves to NULL outside every span rather than reaching for the nearest", () => {
    // A reused symbol belongs to another company before its current holder
    // listed, so the nearest span is the wrong answer, not an approximation.
    const rows = dataset([holding("30303M102", "2010-01-04")]);

    const report = resolveHoldingTickers(rows, [
      { cusip: "30303M102", ticker: "FB", fromDate: "2012-05-18", toDate: "2022-06-08" },
    ]);

    expect(rows.holdings[0]!.resolvedTicker).toBeNull();
    expect(report.outsideEverySpan).toBe(1);
    expect(report.unresolvedCusips).toBe(0);
  });

  it("treats an undated pair as always applying, for symbols that never moved", () => {
    const rows = dataset([holding("037833100", "2013-08-14")]);

    resolveHoldingTickers(rows, [{ cusip: "037833100", ticker: "AAPL" }]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
  });

  it("takes the FIRST covering span, so caller order decides a share class", () => {
    const rows = dataset([holding("037833100", "2025-02-14")]);

    resolveHoldingTickers(rows, [
      { cusip: "037833100", ticker: "AAPL" },
      { cusip: "037833100", ticker: "AAPL.MX" },
    ]);

    expect(rows.holdings[0]!.resolvedTicker).toBe("AAPL");
  });

  it("counts DISTINCT unresolved CUSIPs, not unresolved rows", () => {
    const rows = dataset([
      holding("999999999", "2025-02-14"),
      holding("999999999", "2025-05-14"),
      holding("888888888", "2025-02-14"),
    ]);

    const report = resolveHoldingTickers(rows, []);

    expect(report.unresolved).toBe(3);
    expect(report.unresolvedCusips).toBe(2);
  });

  it("clears a stale ticker rather than leaving a previous pass's value", () => {
    const rows = dataset([holding("999999999", "2025-02-14")]);
    rows.holdings[0]!.resolvedTicker = "WRONG";

    resolveHoldingTickers(rows, []);

    expect(rows.holdings[0]!.resolvedTicker).toBeNull();
  });
});
