import { parseEdgarOwnershipSubmission, SEC_ACCEPTANCE_AVAILABILITY_SOURCE } from "./form4Xml";

function header(accession: string, acceptance: string, type: string): string {
  return [
    `<SEC-DOCUMENT>${accession}.txt : 20260911`,
    `<SEC-HEADER>${accession}.hdr.sgml : 20260911`,
    `<ACCEPTANCE-DATETIME>${acceptance}`,
    `ACCESSION NUMBER:\t\t${accession}`,
    `CONFORMED SUBMISSION TYPE:\t${type}`,
    "PUBLIC DOCUMENT COUNT:\t\t1",
    "FILED AS OF DATE:\t\t20260911",
    "</SEC-HEADER>",
  ].join("\n");
}

/** Trimmed from accession 0001669943-26-000021 (Anterix 4/A), accepted 2026-09-11 12:07:08 ET. */
const ANTERIX_4A = `${header("0001669943-26-000021", "20260911120708", "4/A")}
<DOCUMENT>
<TYPE>4/A
<TEXT>
<XML>
<?xml version="1.0"?>
<ownershipDocument>
    <schemaVersion>X0609</schemaVersion>
    <documentType>4/A</documentType>
    <periodOfReport>2026-09-08</periodOfReport>
    <dateOfOriginalSubmission>2026-09-08</dateOfOriginalSubmission>
    <issuer>
        <issuerCik>0001304492</issuerCik>
        <issuerName>Anterix Inc.</issuerName>
        <issuerTradingSymbol>ATEX</issuerTradingSymbol>
    </issuer>
    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerCik>0001669943</rptOwnerCik>
            <rptOwnerName>Ashe Gena L</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>0</isDirector>
            <isOfficer>1</isOfficer>
            <isTenPercentOwner>0</isTenPercentOwner>
            <isOther>0</isOther>
            <officerTitle>Chief Legal Officer &amp; Corp Sec</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>
    <aff10b5One>0</aff10b5One>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-09-08</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>S</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>293</value></transactionShares>
                <transactionPricePerShare><value>85.44</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>9238</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-09-08</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>F</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>2769</value><footnoteId id="F1"/></transactionShares>
                <transactionPricePerShare><value>86.27</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>13302</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
    <derivativeTable>
        <derivativeTransaction>
            <securityTitle><value>Stock Option (Right to Buy)</value></securityTitle>
            <conversionOrExercisePrice><value>34.96</value></conversionOrExercisePrice>
            <transactionDate><value>2026-09-08</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>M</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>6833</value></transactionShares>
                <transactionPricePerShare><value>0</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <exerciseDate><footnoteId id="F2"/></exerciseDate>
            <expirationDate><value>2035-05-20</value></expirationDate>
            <underlyingSecurity>
                <underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle>
                <underlyingSecurityShares><value>6833</value></underlyingSecurityShares>
            </underlyingSecurity>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>35658</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </derivativeTransaction>
    </derivativeTable>
</ownershipDocument>
</XML>
</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;

/** A joint filing in the shape of 0000905148-26-004140, with a value-denominated derivative transaction per the v5.1 schema. */
const JOINT_4 = `${header("0000000000-26-000001", "20260911173000", "4")}
<XML>
<ownershipDocument>
    <documentType>4</documentType>
    <periodOfReport>2026-09-10</periodOfReport>
    <issuer>
        <issuerCik>0000000001</issuerCik>
        <issuerName>Example Issuer Corp</issuerName>
        <issuerTradingSymbol></issuerTradingSymbol>
    </issuer>
    <reportingOwner>
        <reportingOwnerId><rptOwnerCik>0002151490</rptOwnerCik><rptOwnerName>Fund GP LLC</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>false</isDirector>
            <isTenPercentOwner>true</isTenPercentOwner>
            <isOther>true</isOther>
            <otherText>Member of 13(d) group</otherText>
        </reportingOwnerRelationship>
    </reportingOwner>
    <reportingOwner>
        <reportingOwnerId><rptOwnerCik>0001698097</rptOwnerCik><rptOwnerName>Fund LP</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isTenPercentOwner>true</isTenPercentOwner></reportingOwnerRelationship>
    </reportingOwner>
    <derivativeTable>
        <derivativeTransaction>
            <securityTitle><value>Total Return Swap</value></securityTitle>
            <conversionOrExercisePrice><footnoteId id="F1"/></conversionOrExercisePrice>
            <transactionDate><value>2026-09-10-04:00</value></transactionDate>
            <deemedExecutionDate><value>2026-09-09</value></deemedExecutionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>J</transactionCode>
                <equitySwapInvolved>1</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionTotalValue><value>2500000</value></transactionTotalValue>
                <transactionPricePerShare><footnoteId id="F2"/></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <exerciseDate><value>2026-09-10</value></exerciseDate>
            <expirationDate><value>2027-09-10</value></expirationDate>
            <underlyingSecurity>
                <underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle>
            </underlyingSecurity>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>0</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>I</value></directOrIndirectOwnership>
                <natureOfOwnership><value>See Footnote</value><footnoteId id="F3"/></natureOfOwnership>
            </ownershipNature>
        </derivativeTransaction>
    </derivativeTable>
</ownershipDocument>
</XML>`;

describe("form4Xml", () => {
  it("reads an amended Form 4 into filing and transaction rows available one minute after acceptance", () => {
    const { filings, transactions } = parseEdgarOwnershipSubmission(ANTERIX_4A, "sec/filings/raw.txt");
    const availableAt = new Date("2026-09-11T16:08:08.000Z");
    expect(filings).toEqual([
      {
        accession: "0001669943-26-000021",
        formType: "4/A",
        filingDate: "2026-09-11",
        availableAt,
        availabilitySource: SEC_ACCEPTANCE_AVAILABILITY_SOURCE,
        periodOfReport: "2026-09-08",
        dateOfOriginalSubmission: "2026-09-08",
        issuerCik: "0001304492",
        issuerName: "Anterix Inc.",
        issuerTicker: "ATEX",
        ownerCik: "0001669943",
        ownerName: "Ashe Gena L",
        isDirector: false,
        isOfficer: true,
        isTenPercentOwner: false,
        isOther: false,
        officerTitle: "Chief Legal Officer & Corp Sec",
        ownerRelationshipText: null,
        aff10b5One: false,
        rawArchiveKey: "sec/filings/raw.txt",
      },
    ]);
    expect(transactions.map((row) => [row.rowKind, row.rowSk, row.transactionCode, row.shares, row.pricePerShare])).toEqual([
      ["nonderiv", "1", "S", 293, 85.44],
      ["nonderiv", "2", "F", 2769, 86.27],
      ["deriv", "1", "M", 6833, 0],
    ]);
    expect(transactions[2]).toMatchObject({
      availableAt,
      transactionDate: "2026-09-08",
      acquiredDisposed: "D",
      sharesOwnedFollowing: 35658,
      exercisePrice: 34.96,
      exerciseDate: null,
      expirationDate: "2035-05-20",
      underlyingTitle: "Common Stock",
      underlyingShares: 6833,
      totalValue: null,
    });
    expect(transactions[0]).toMatchObject({ exercisePrice: null, underlyingShares: null, deemedExecutionDate: null });
  });

  it("gives each joint filer a filing row, writes transactions once, and reads value-denominated derivatives", () => {
    const { filings, transactions } = parseEdgarOwnershipSubmission(JOINT_4, "raw");
    expect(filings.map((row) => [row.ownerCik, row.isTenPercentOwner, row.isOther, row.ownerRelationshipText])).toEqual([
      ["0002151490", true, true, "Member of 13(d) group"],
      ["0001698097", true, false, null],
    ]);
    expect(filings[0]).toMatchObject({ issuerTicker: null, aff10b5One: null, dateOfOriginalSubmission: null });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      transactionDate: "2026-09-10",
      deemedExecutionDate: "2026-09-09",
      equitySwapInvolved: true,
      shares: null,
      totalValue: 2500000,
      pricePerShare: null,
      exercisePrice: null,
      underlyingShares: null,
      directIndirect: "I",
      natureOfOwnership: "See Footnote",
    });
  });

  it("refuses a submission without an acceptance time or an ownership document", () => {
    expect(() => parseEdgarOwnershipSubmission(ANTERIX_4A.replace(/<ACCEPTANCE-DATETIME>\d+\n/, ""), "raw")).toThrow(
      "EDGAR submission header is missing ACCEPTANCE-DATETIME"
    );
    expect(() => parseEdgarOwnershipSubmission(header("0000000000-26-000002", "20260911120708", "4"), "raw")).toThrow(
      "EDGAR submission 0000000000-26-000002 has no ownershipDocument"
    );
  });
});
