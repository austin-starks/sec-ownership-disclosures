import {
  bucketByAvailableYear,
  INSIDER_FILINGS_COLUMNS,
  INSIDER_TRANSACTIONS_COLUMNS,
  toParquetRow,
} from "./insiderLakeTables";

describe("insiderLakeTables", () => {
  it("declares point-in-time and date columns with their storage types", () => {
    expect(INSIDER_FILINGS_COLUMNS.availableAt).toBe("TIMESTAMP");
    expect(INSIDER_FILINGS_COLUMNS.filingDate).toBe("DATE");
    expect(INSIDER_TRANSACTIONS_COLUMNS.availableAt).toBe("TIMESTAMP");
    expect(INSIDER_TRANSACTIONS_COLUMNS.shares).toBe("DOUBLE");
    expect(Object.keys(INSIDER_TRANSACTIONS_COLUMNS)).not.toContain("ownerCik");
  });

  it("buckets rows by the UTC year of availableAt, so a Dec 31 filing lands in the next year", () => {
    const rows = [
      { id: "a", availableAt: new Date("2026-01-01T04:59:59.999Z") },
      { id: "b", availableAt: new Date("2025-06-30T03:59:59.999Z") },
      { id: "c", availableAt: new Date("2025-12-31T04:59:59.999Z") },
    ];
    const buckets = bucketByAvailableYear(rows);
    expect([...buckets.keys()]).toEqual([2025, 2026]);
    expect(buckets.get(2025)?.map((row) => row.id)).toEqual(["b", "c"]);
    expect(buckets.get(2026)?.map((row) => row.id)).toEqual(["a"]);
  });

  it("copies a row into a plain record for the writer", () => {
    const availableAt = new Date("2025-11-01T03:59:59.999Z");
    const row = toParquetRow({ accession: "x", availableAt, isDirector: true, shares: null });
    expect(row).toEqual({ accession: "x", availableAt, isDirector: true, shares: null });
  });
});
