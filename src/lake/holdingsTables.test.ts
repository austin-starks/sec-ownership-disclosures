import {
  THIRTEEN_F_FILINGS_COLUMNS,
  THIRTEEN_F_FILINGS_ORDER_BY,
  THIRTEEN_F_FILINGS_PREFIX,
  THIRTEEN_F_HOLDINGS_COLUMNS,
  THIRTEEN_F_HOLDINGS_ORDER_BY,
  THIRTEEN_F_HOLDINGS_PREFIX,
} from "./holdingsTables";

describe("holdings lake tables", () => {
  it("publishes under the institutional prefixes", () => {
    expect(THIRTEEN_F_FILINGS_PREFIX).toBe("institutional_filings");
    expect(THIRTEEN_F_HOLDINGS_PREFIX).toBe("institutional_holdings");
    expect(THIRTEEN_F_FILINGS_ORDER_BY).toBe("accession, availableAt");
    expect(THIRTEEN_F_HOLDINGS_ORDER_BY).toBe("cusip, availableAt");
  });

  it("types every filing row field as a column", () => {
    expect(THIRTEEN_F_FILINGS_COLUMNS).toMatchObject({
      accession: "VARCHAR",
      availableAt: "TIMESTAMP",
      submissionType: "VARCHAR",
      cik: "VARCHAR",
      isAmendment: "BOOLEAN",
    });
  });

  it("keeps CUSIP and FIGI as separate nullable-safe holding columns", () => {
    expect(THIRTEEN_F_HOLDINGS_COLUMNS).toMatchObject({
      cusip: "VARCHAR",
      figi: "VARCHAR",
      value: "DOUBLE",
      sharesAmount: "DOUBLE",
    });
  });
});
