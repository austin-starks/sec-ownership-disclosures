import { refreshInsiderFilings, type InsiderRefreshDeps } from "./insiderRefresh";

const PREAMBLE = [
  "Description:           Daily Index of EDGAR Dissemination Feed by Form Type",
  "Last Data Received:    Sep 11, 2026",
  " ",
  "Form Type   Company Name                                                  CIK         Date Filed  File Name",
  "---------------------------------------------------------------------------------------------------------------------------------------------",
];

const INDEX = [
  ...PREAMBLE,
  "1-A POS          McQueen Labs Series, LLC                                      2025795     20260911    edgar/data/2025795/0001493152-26-042361.txt",
  "4                Apple Inc.                                                    320193      20260911    edgar/data/320193/0000000001-26-000001.txt",
  "4                Owner Jane                                                    1214156     20260911    edgar/data/1214156/0000000001-26-000001.txt",
  "3/A              Known Filer                                                   4977        20260911    edgar/data/4977/0000000002-26-000002.txt",
  "4                Unreachable Filer                                             1770787     20260911    edgar/data/1770787/0000000003-26-000003.txt",
  "",
].join("\n");

const SUBMISSION = `<SEC-DOCUMENT>0000000001-26-000001.txt : 20260911
<SEC-HEADER>0000000001-26-000001.hdr.sgml : 20260911
<ACCEPTANCE-DATETIME>20260911160000
ACCESSION NUMBER:		0000000001-26-000001
CONFORMED SUBMISSION TYPE:	4
PUBLIC DOCUMENT COUNT:		1
FILED AS OF DATE:		20260911
</SEC-HEADER>
<XML>
<ownershipDocument>
    <documentType>4</documentType>
    <periodOfReport>2026-09-09</periodOfReport>
    <issuer>
        <issuerCik>0000320193</issuerCik>
        <issuerName>Apple Inc.</issuerName>
        <issuerTradingSymbol>AAPL</issuerTradingSymbol>
    </issuer>
    <reportingOwner>
        <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>Owner Jane</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>CFO</officerTitle></reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-09-09</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>S</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>100</value></transactionShares>
                <transactionPricePerShare><value>200</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>900</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
</ownershipDocument>
</XML>
</SEC-DOCUMENT>`;

describe("insiderRefresh", () => {
  it("reads new insider submissions once per accession, skips known ones, and leaves failures for a later pass", async () => {
    const archived: string[] = [];
    const deps: InsiderRefreshDeps = {
      fetchDailyIndex: async (date) => (date === "2026-09-11" ? INDEX : null),
      fetchSubmission: async (entry) => {
        if (entry.accession === "0000000003-26-000003") throw new Error("Request failed with status code 503");
        return { text: SUBMISSION, url: `https://www.sec.gov/Archives/${entry.fileName}` };
      },
      archiveSubmission: async (entry) => {
        archived.push(entry.accession);
        return `sec/filings/${entry.accession}.txt`;
      },
    };

    const refreshed = await refreshInsiderFilings(deps, {
      dates: ["2026-09-11", "2026-09-12"],
      knownAccessions: new Set(["0000000002-26-000002"]),
      maxSubmissions: 10,
    });

    expect(refreshed.unpublishedDays).toEqual(["2026-09-12"]);
    expect(refreshed.listed).toBe(3);
    expect(refreshed.processed).toEqual(["0000000001-26-000001", "0000000003-26-000003"]);
    expect(refreshed.deferred).toBe(0);
    expect(refreshed.failures).toEqual(["0000000003-26-000003: Request failed with status code 503"]);
    expect(archived).toEqual(["0000000001-26-000001"]);
    expect(refreshed.rows.filings).toHaveLength(1);
    expect(refreshed.rows.transactions).toEqual([
      expect.objectContaining({
        accession: "0000000001-26-000001",
        availabilitySource: "sec_acceptance_datetime",
        transactionCode: "S",
        shares: 100,
        rawArchiveKey: "sec/filings/0000000001-26-000001.txt",
      }),
    ]);
  });

  it("defers submissions past the per-pass limit and reports an unreadable index", async () => {
    const refreshed = await refreshInsiderFilings(
      {
        fetchDailyIndex: async (date) => (date === "2026-09-11" ? INDEX : "not an index"),
        fetchSubmission: async () => ({ text: SUBMISSION, url: "" }),
        archiveSubmission: async () => "key",
      },
      { dates: ["2026-09-10", "2026-09-11"], knownAccessions: new Set(), maxSubmissions: 1 }
    );
    expect(refreshed.failures).toEqual(["index 2026-09-10: EDGAR daily index has no header separator"]);
    expect(refreshed.processed).toEqual(["0000000001-26-000001"]);
    expect(refreshed.deferred).toBe(2);
  });
});
