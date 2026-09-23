import {
  buildCrosswalkFromMembers,
  cusipFromIsin,
} from "./cusipTickerCrosswalk";

/** Build a TSV member the way SEC lays these files out. */
function tsv(header: string[], rows: string[][]): Buffer {
  return Buffer.from([header, ...rows].map((row) => row.join("\t")).join("\n") + "\n", "utf8");
}

const HOLDING_HEADER = [
  "ACCESSION_NUMBER",
  "HOLDING_ID",
  "ISSUER_NAME",
  "ISSUER_LEI",
  "ISSUER_TITLE",
  "ISSUER_CUSIP",
  "BALANCE",
];
const IDENTIFIER_HEADER = [
  "HOLDING_ID",
  "IDENTIFIERS_ID",
  "IDENTIFIER_ISIN",
  "IDENTIFIER_TICKER",
  "OTHER_IDENTIFIER",
  "OTHER_IDENTIFIER_DESC",
];

describe("cusipFromIsin", () => {
  it("takes the CUSIP out of a US ISIN and refuses a foreign one", () => {
    expect(cusipFromIsin("US15118V2079")).toBe("15118V207");
    expect(cusipFromIsin("US00971T1016")).toBe("00971T101");
    expect(cusipFromIsin("GB0002374006")).toBeNull();
    expect(cusipFromIsin("US123")).toBeNull();
  });
});

describe("buildCrosswalkFromMembers", () => {
  it("folds a holding's identifiers across the separate rows SEC writes them on", () => {
    // This is the real shape: HOLDING_ID 1 carries its ISIN on one row and its
    // ticker on another. Reading one row per holding would find no ticker.
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "US15118V2079", "", "", ""],
      ["1", "12", "", "CELH", "", ""],
    ]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Celsius Holdings Inc", "N/A", "Common", "15118V207", "100"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toEqual([
      {
        cusip: "15118V207",
        ticker: "CELH",
        issuerName: "Celsius Holdings Inc",
        isin: "US15118V2079",
        source: "nport:2026q2",
      },
    ]);
    expect(stats.holdingsWithTicker).toBe(1);
    expect(stats.isinMismatches).toBe(0);
  });

  it("drops a row whose ISIN contradicts its CUSIP instead of picking one", () => {
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "US00971T1016", "", "", ""],
      ["1", "12", "", "AKAM", "", ""],
    ]);
    // ISIN says 00971T101 (Akamai); the CUSIP column says Apple's.
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Akamai Technologies", "N/A", "Common", "037833100", "100"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toEqual([]);
    expect(stats.isinMismatches).toBe(1);
  });

  it("drops SEC's placeholder CUSIPs, which are not securities", () => {
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "", "EURFUT", "", ""],
      ["2", "21", "", "CASH", "", ""],
      ["3", "31", "", "NA", "", ""],
    ]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "EUR/USD FUTURE JUN 2026", "N/A", "Future", "999999999", "-100"],
      ["0001-26-1", "2", "Cash sweep", "N/A", "Cash", "000000000", "1"],
      ["0001-26-1", "3", "Unidentified", "N/A", "Other", "N/A", "1"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toEqual([]);
    expect(stats.placeholderCusips).toBe(3);
  });

  it("emits one pair however many funds hold the same security", () => {
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "", "AAPL", "", ""],
      ["2", "21", "", "AAPL", "", ""],
      ["3", "31", "", "AAPL", "", ""],
    ]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Apple Inc", "N/A", "Common", "037833100", "100"],
      ["0001-26-2", "2", "Apple Inc.", "N/A", "Common", "037833100", "250"],
      ["0001-26-3", "3", "APPLE INC", "N/A", "Common", "037833100", "9"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ cusip: "037833100", ticker: "AAPL" });
    expect(stats.holdingRows).toBe(3);
    expect(stats.distinctCusips).toBe(1);
  });

  it("keeps both tickers when one CUSIP legitimately reports under two symbols", () => {
    // Share classes and dual listings do this; the crosswalk records both and
    // lets the identity build decide, rather than silently keeping the first.
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "", "GOOG", "", ""],
      ["2", "21", "", "GOOGL", "", ""],
    ]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Alphabet Inc", "N/A", "Class C", "02079K107", "100"],
      ["0001-26-2", "2", "Alphabet Inc", "N/A", "Class A", "02079K107", "100"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs.map((pair) => pair.ticker).sort()).toEqual(["GOOG", "GOOGL"]);
    expect(stats.distinctCusips).toBe(1);
  });

  it("ignores a holding whose identifiers never name a ticker", () => {
    const identifiers = tsv(IDENTIFIER_HEADER, [["1", "11", "US15118V2079", "", "", ""]]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Celsius Holdings Inc", "N/A", "Common", "15118V207", "100"],
    ]);

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toEqual([]);
    expect(stats.holdingsWithTicker).toBe(0);
    expect(stats.holdingRows).toBe(1);
  });
});

describe("field-count drift", () => {
  it("drops a row carrying an unescaped tab instead of reading a shifted column", () => {
    // ISSUER_NAME contains a raw tab, so every later field shifts left by one
    // and ISSUER_CUSIP would be read out of BALANCE. Without the shape check
    // this emits a confident, wrong pair rather than nothing.
    const identifiers = tsv(IDENTIFIER_HEADER, [["1", "11", "", "AAPL", "", ""]]);
    const holdings = Buffer.from(
      [
        HOLDING_HEADER.join("\t"),
        ["0001-26-1", "1", "Apple\tInc", "N/A", "Common", "037833100", "100"].join("\t"),
      ].join("\n") + "\n",
      "utf8",
    );

    const { pairs, stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(pairs).toEqual([]);
    expect(stats.fieldCountMismatches).toBe(1);
  });

  it("counts identifier rows without a second pass over the member", () => {
    const identifiers = tsv(IDENTIFIER_HEADER, [
      ["1", "11", "US0378331005", "", "", ""],
      ["1", "12", "", "AAPL", "", ""],
      ["2", "21", "", "MSFT", "", ""],
    ]);
    const holdings = tsv(HOLDING_HEADER, [
      ["0001-26-1", "1", "Apple Inc", "N/A", "Common", "037833100", "100"],
    ]);

    const { stats } = buildCrosswalkFromMembers(holdings, identifiers, "nport:2026q2");

    expect(stats.identifierRows).toBe(3);
    expect(stats.fieldCountMismatches).toBe(0);
  });
});
