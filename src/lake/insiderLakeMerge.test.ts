import { SEC_DATASET_AVAILABILITY_SOURCE, type Form345DatasetRows, type InsiderFilingRow, type InsiderTransactionRow } from "../extraction/form345Dataset";
import { SEC_ACCEPTANCE_AVAILABILITY_SOURCE } from "../extraction/form4Xml";
import { mergeInsiderRows } from "./insiderLakeMerge";

function filing(accession: string, availabilitySource: string): InsiderFilingRow {
  return {
    accession,
    formType: "4",
    filingDate: "2026-09-11",
    availableAt: new Date("2026-09-11T20:48:39.000Z"),
    availabilitySource,
    periodOfReport: "2026-09-09",
    dateOfOriginalSubmission: null,
    issuerCik: "0000320193",
    issuerName: "Apple Inc.",
    issuerTicker: "AAPL",
    resolvedTicker: "AAPL",
    ownerCik: "0001214156",
    ownerName: "Owner",
    isDirector: false,
    isOfficer: true,
    isTenPercentOwner: false,
    isOther: false,
    officerTitle: "CFO",
    ownerRelationshipText: null,
    aff10b5One: false,
    rawArchiveKey: `raw/${accession}`,
  };
}

function transaction(accession: string, availabilitySource: string, rowSk: string): InsiderTransactionRow {
  return {
    accession,
    rowKind: "nonderiv",
    rowSk,
    formType: "4",
    issuerCik: "0000320193",
    issuerTicker: "AAPL",
    resolvedTicker: "AAPL",
    availableAt: new Date("2026-09-11T20:48:39.000Z"),
    availabilitySource,
    securityTitle: "Common Stock",
    transactionDate: "2026-09-09",
    deemedExecutionDate: null,
    transactionFormType: "4",
    transactionCode: "S",
    equitySwapInvolved: false,
    acquiredDisposed: "D",
    shares: 100,
    pricePerShare: 200,
    totalValue: null,
    sharesOwnedFollowing: 1000,
    directIndirect: "D",
    natureOfOwnership: null,
    exercisePrice: null,
    exerciseDate: null,
    expirationDate: null,
    underlyingTitle: null,
    underlyingShares: null,
    rawArchiveKey: `raw/${accession}`,
  };
}

function rows(accession: string, source: string, sks: string[]): Form345DatasetRows {
  return { filings: [filing(accession, source)], transactions: sks.map((sk) => transaction(accession, source, sk)) };
}

function union(...parts: Form345DatasetRows[]): Form345DatasetRows {
  return { filings: parts.flatMap((part) => part.filings), transactions: parts.flatMap((part) => part.transactions) };
}

const DAILY = SEC_ACCEPTANCE_AVAILABILITY_SOURCE;
const DATASET = SEC_DATASET_AVAILABILITY_SOURCE;

describe("insiderLakeMerge", () => {
  it("keeps EDGAR acceptance-time rows over a later data set for the same accession", () => {
    const merged = mergeInsiderRows(rows("A", DAILY, ["1", "2"]), rows("A", DATASET, ["901"]));
    expect(merged.transactions.map((row) => [row.accession, row.rowSk, row.availabilitySource])).toEqual([
      ["A", "1", DAILY],
      ["A", "2", DAILY],
    ]);
  });

  it("lets EDGAR rows replace data set rows, a newer read replace the same source, and keeps other accessions", () => {
    const existing = union(rows("A", DATASET, ["901"]), rows("B", DAILY, ["1"]), rows("C", DATASET, ["902"]));
    const incoming = union(rows("A", DAILY, ["1"]), rows("B", DAILY, ["1", "2"]));
    const merged = mergeInsiderRows(existing, incoming);
    expect(merged.filings.map((row) => [row.accession, row.availabilitySource])).toEqual([
      ["C", DATASET],
      ["A", DAILY],
      ["B", DAILY],
    ]);
    expect(merged.transactions.map((row) => `${row.accession}/${row.rowSk}`)).toEqual(["C/902", "A/1", "B/1", "B/2"]);
  });

  it("refuses an accession whose rows claim two availability sources", () => {
    const mixed = { filings: [filing("A", DAILY)], transactions: [transaction("A", DATASET, "1")] };
    expect(() => mergeInsiderRows(mixed, union())).toThrow("Accession A mixes availability sources");
  });
});
