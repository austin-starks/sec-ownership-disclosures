import { checkInsiderWindow } from "./insiderChecks";
import type { Form345DatasetRows, InsiderFilingRow, InsiderTransactionRow } from "../extraction/form345Dataset";

function filing(overrides: Partial<InsiderFilingRow> = {}): InsiderFilingRow {
  return {
    accession: "0001-25-000001",
    formType: "4",
    filingDate: "2025-10-31",
    availableAt: new Date("2025-11-01T03:59:59.999Z"),
    availabilitySource: "s",
    periodOfReport: "2025-10-29",
    dateOfOriginalSubmission: null,
    issuerCik: "0000000001",
    issuerName: "Example Inc",
    issuerTicker: "EX",
    resolvedTicker: "EX",
    ownerCik: "0000000002",
    ownerName: "Owner One",
    isDirector: false,
    isOfficer: true,
    isTenPercentOwner: false,
    isOther: false,
    officerTitle: null,
    ownerRelationshipText: null,
    aff10b5One: null,
    rawArchiveKey: "k",
    ...overrides,
  };
}

function transaction(overrides: Partial<InsiderTransactionRow> = {}): InsiderTransactionRow {
  return {
    accession: "0001-25-000001",
    rowKind: "nonderiv",
    rowSk: "1",
    formType: "4",
    issuerCik: "0000000001",
    issuerTicker: "EX",
    resolvedTicker: "EX",
    availableAt: new Date("2025-11-01T03:59:59.999Z"),
    availabilitySource: "s",
    securityTitle: "Common Stock",
    transactionDate: "2025-10-29",
    deemedExecutionDate: null,
    transactionFormType: null,
    transactionCode: "P",
    equitySwapInvolved: null,
    acquiredDisposed: "A",
    shares: 100,
    pricePerShare: 10,
    totalValue: null,
    sharesOwnedFollowing: null,
    directIndirect: null,
    natureOfOwnership: null,
    exercisePrice: null,
    exerciseDate: null,
    expirationDate: null,
    underlyingTitle: null,
    underlyingShares: null,
    rawArchiveKey: "k",
    ...overrides,
  };
}

describe("checkInsiderWindow", () => {
  it("clears a clean window and flags the failure classes", () => {
    const rows: Form345DatasetRows = {
      filings: [filing(), filing({ accession: "0001-25-000002", formType: "4/A", dateOfOriginalSubmission: null })],
      transactions: [
        transaction(),
        transaction({ accession: "9999", rowSk: "9" }),
        transaction({ rowSk: "2", transactionDate: "2025-12-01" }),
        transaction({ rowSk: "3", transactionCode: "Z" }),
        transaction({ rowSk: "4", issuerTicker: null, resolvedTicker: null }),
      ],
    };
    const report = checkInsiderWindow("w", rows);
    expect(report.filings).toBe(2);
    expect(report.accessions).toBe(2);
    expect(report.orphanTransactions).toBe(1);
    expect(report.futureDatedTransactions).toBe(1);
    expect(report.transactionCodes).toMatchObject({ P: 3, Z: 1 });
    expect(report.nullTickerTransactions).toBe(1);
    expect(report.amendmentsWithoutOriginalDate).toBe(1);
    expect(report.filingDateRange).toEqual({ min: "2025-10-31", max: "2025-10-31" });
  });

  it("catches duplicate owner rows and negative amounts", () => {
    const rows: Form345DatasetRows = {
      filings: [filing(), filing()],
      transactions: [transaction({ shares: -5 })],
    };
    const report = checkInsiderWindow("w", rows);
    expect(report.duplicateFilingKeys).toHaveLength(1);
    expect(report.negativeAmounts).toBe(1);
  });
});
