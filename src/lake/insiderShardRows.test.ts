import type { InsiderFilingRow, InsiderTransactionRow } from "../extraction/form345Dataset";
import { insiderFilingFromShard, insiderTransactionFromShard } from "./insiderShardRows";

const FILING: InsiderFilingRow = {
  accession: "0001669943-26-000021",
  formType: "4/A",
  filingDate: "2026-09-11",
  availableAt: new Date("2026-09-11T16:08:08.000Z"),
  availabilitySource: "sec_acceptance_datetime",
  periodOfReport: "2026-09-08",
  dateOfOriginalSubmission: "2026-09-08",
  issuerCik: "0001304492",
  issuerName: "Anterix Inc.",
  issuerTicker: "ATEX",
  resolvedTicker: "ATEX",
  ownerCik: "0001669943",
  ownerName: "Ashe Gena L",
  isDirector: false,
  isOfficer: true,
  isTenPercentOwner: false,
  isOther: false,
  officerTitle: "Chief Legal Officer & Corp Sec",
  ownerRelationshipText: null,
  aff10b5One: false,
  rawArchiveKey: "sec/filings/0001669943/0001669943-26-000021/abc.txt",
  isCeo: false,
  ceoTitleRule: "ceo-title2",
};

const TRANSACTION: InsiderTransactionRow = {
  accession: "0001669943-26-000021",
  rowKind: "deriv",
  rowSk: "1",
  formType: "4/A",
  issuerCik: "0001304492",
  issuerTicker: "ATEX",
  resolvedTicker: "ATEX",
  availableAt: new Date("2026-09-11T16:08:08.000Z"),
  availabilitySource: "sec_acceptance_datetime",
  securityTitle: "Stock Option (Right to Buy)",
  transactionDate: "2026-09-08",
  deemedExecutionDate: null,
  transactionFormType: "4",
  transactionCode: "M",
  equitySwapInvolved: false,
  acquiredDisposed: "D",
  shares: 6833,
  pricePerShare: 0,
  totalValue: null,
  sharesOwnedFollowing: 35658,
  directIndirect: "D",
  natureOfOwnership: null,
  exercisePrice: 34.96,
  exerciseDate: null,
  expirationDate: "2035-05-20",
  underlyingTitle: "Common Stock",
  underlyingShares: 6833,
  rawArchiveKey: "sec/filings/0001669943/0001669943-26-000021/abc.txt",
};

describe("insiderShardRows", () => {
  it("reads back filing and transaction rows exactly as they were written", () => {
    expect(insiderFilingFromShard({ ...FILING })).toEqual(FILING);
    expect(insiderTransactionFromShard({ ...TRANSACTION })).toEqual(TRANSACTION);
  });

  it("derives resolvedTicker for a shard written before the column existed", () => {
    const { resolvedTicker: _dropped, ...legacy } = { ...TRANSACTION, issuerTicker: "NYSE: ATEX" };
    expect(insiderTransactionFromShard(legacy).resolvedTicker).toBe("ATEX");
    // A shard that has the column is trusted as written, including a null.
    expect(insiderTransactionFromShard({ ...TRANSACTION, resolvedTicker: null }).resolvedTicker).toBeNull();
  });

  it("derives isCeo from the title for a shard written before the columns existed", () => {
    const { isCeo: _isCeo, ceoTitleRule: _rule, ...legacy } = { ...FILING, officerTitle: "President & CEO" };
    expect(insiderFilingFromShard(legacy)).toMatchObject({ isCeo: true, ceoTitleRule: "ceo-title2" });
    // A year read through a union with newer years carries the columns as null.
    expect(insiderFilingFromShard({ ...legacy, isCeo: null, ceoTitleRule: null })).toMatchObject({
      isCeo: true,
      ceoTitleRule: "ceo-title2",
    });
  });

  it("trusts isCeo written under the current rule and reclassifies one written under another", () => {
    // Written by the current rule: read as stored.
    expect(insiderFilingFromShard({ ...FILING, isCeo: true }).isCeo).toBe(true);
    // Written by an earlier rule: the title is read again, so a republished year carries one rule.
    const stale = { ...FILING, officerTitle: "CEO-Elect", isCeo: true, ceoTitleRule: "ceo-title1" };
    expect(insiderFilingFromShard(stale)).toMatchObject({ isCeo: false, ceoTitleRule: "ceo-title2" });
  });

  it("refuses a CEO flag stamped by a newer rule than this package knows", () => {
    expect(() => insiderFilingFromShard({ ...FILING, isCeo: true, ceoTitleRule: "ceo-title3" })).toThrow(
      "insider_filings row was classified by ceo-title3, newer than this package's ceo-title2; upgrade sec-ownership-disclosures to read it"
    );
    expect(() => insiderFilingFromShard({ ...FILING, ceoTitleRule: "manual" })).toThrow(
      'insider_filings row has an unexpected ceoTitleRule: "manual"'
    );
  });

  it("stops on a value outside the row's type", () => {
    expect(() => insiderTransactionFromShard({ ...TRANSACTION, rowKind: "holding" })).toThrow(
      'insider_transactions row has an unexpected rowKind: "holding"'
    );
    expect(() => insiderFilingFromShard({ ...FILING, isOfficer: "1" })).toThrow('insider_filings row has an unexpected isOfficer: "1"');
    expect(() => insiderFilingFromShard({ ...FILING, isCeo: null })).toThrow("insider_filings row has an unexpected isCeo: null");
    expect(() => insiderFilingFromShard({ ...FILING, ceoTitleRule: 2 })).toThrow("insider_filings row has an unexpected ceoTitleRule: 2");
  });
});
