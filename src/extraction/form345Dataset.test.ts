import JSZip from "jszip";

import { parseForm345Dataset, SEC_DATASET_AVAILABILITY_SOURCE } from "./form345Dataset";

function tsv(header: string[], rows: string[][]): string {
  return [header.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n") + "\n";
}

const SUBMISSION = [
  "ACCESSION_NUMBER", "FILING_DATE", "PERIOD_OF_REPORT", "DATE_OF_ORIG_SUB", "NO_SECURITIES_OWNED",
  "NOT_SUBJECT_SEC16", "FORM3_HOLDINGS_REPORTED", "FORM4_TRANS_REPORTED", "DOCUMENT_TYPE", "ISSUERCIK",
  "ISSUERNAME", "ISSUERTRADINGSYMBOL", "REMARKS", "AFF10B5ONE",
];
const OWNER = [
  "ACCESSION_NUMBER", "RPTOWNERCIK", "RPTOWNERNAME", "RPTOWNER_RELATIONSHIP", "RPTOWNER_TITLE",
  "RPTOWNER_TXT", "RPTOWNER_STREET1", "RPTOWNER_STREET2", "RPTOWNER_CITY", "RPTOWNER_STATE",
  "RPTOWNER_ZIPCODE", "RPTOWNER_STATE_DESC", "FILE_NUMBER",
];
const NONDERIV = [
  "ACCESSION_NUMBER", "NONDERIV_TRANS_SK", "SECURITY_TITLE", "SECURITY_TITLE_FN", "TRANS_DATE", "TRANS_DATE_FN",
  "DEEMED_EXECUTION_DATE", "DEEMED_EXECUTION_DATE_FN", "TRANS_FORM_TYPE", "TRANS_CODE", "EQUITY_SWAP_INVOLVED",
  "EQUITY_SWAP_TRANS_CD_FN", "TRANS_TIMELINESS", "TRANS_TIMELINESS_FN", "TRANS_SHARES", "TRANS_SHARES_FN",
  "TRANS_PRICEPERSHARE", "TRANS_PRICEPERSHARE_FN", "TRANS_ACQUIRED_DISP_CD", "TRANS_ACQUIRED_DISP_CD_FN",
  "SHRS_OWND_FOLWNG_TRANS", "SHRS_OWND_FOLWNG_TRANS_FN", "VALU_OWND_FOLWNG_TRANS", "VALU_OWND_FOLWNG_TRANS_FN",
  "DIRECT_INDIRECT_OWNERSHIP", "DIRECT_INDIRECT_OWNERSHIP_FN", "NATURE_OF_OWNERSHIP", "NATURE_OF_OWNERSHIP_FN",
];
const DERIV = [
  "ACCESSION_NUMBER", "DERIV_TRANS_SK", "SECURITY_TITLE", "SECURITY_TITLE_FN", "CONV_EXERCISE_PRICE",
  "CONV_EXERCISE_PRICE_FN", "TRANS_DATE", "TRANS_DATE_FN", "DEEMED_EXECUTION_DATE", "DEEMED_EXECUTION_DATE_FN",
  "TRANS_FORM_TYPE", "TRANS_CODE", "EQUITY_SWAP_INVOLVED", "EQUITY_SWAP_INVOLVED_FN", "TRANS_TIMELINESS",
  "TRANS_TIMELINESS_FN", "TRANS_SHARES", "TRANS_SHARES_FN", "TRANS_TOTAL_VALUE", "TRANS_TOTAL_VALUE_FN",
  "TRANS_PRICEPERSHARE", "TRANS_PRICEPERSHARE_FN", "TRANS_ACQUIRED_DISP_CD", "TRANS_ACQUIRED_DISP_CD_FN",
  "EXCERCISE_DATE", "EXCERCISE_DATE_FN", "EXPIRATION_DATE", "EXPIRATION_DATE_FN", "UNDLYNG_SEC_TITLE",
  "UNDLYNG_SEC_TITLE_FN", "UNDLYNG_SEC_SHARES", "UNDLYNG_SEC_SHARES_FN", "UNDLYNG_SEC_VALUE",
  "UNDLYNG_SEC_VALUE_FN", "SHRS_OWND_FOLWNG_TRANS", "SHRS_OWND_FOLWNG_TRANS_FN", "VALU_OWND_FOLWNG_TRANS",
  "VALU_OWND_FOLWNG_TRANS_FN", "DIRECT_INDIRECT_OWNERSHIP", "DIRECT_INDIRECT_OWNERSHIP_FN", "NATURE_OF_OWNERSHIP",
  "NATURE_OF_OWNERSHIP_FN",
];

function blankRow(header: string[], values: Record<string, string>): string[] {
  return header.map((column) => values[column] ?? "");
}

async function datasetZip(overrides: { submission?: string } = {}): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "SUBMISSION.tsv",
    overrides.submission ??
      tsv(SUBMISSION, [
        blankRow(SUBMISSION, {
          ACCESSION_NUMBER: "0001-25-000241", FILING_DATE: "31-OCT-2025", PERIOD_OF_REPORT: "29-OCT-2025",
          DOCUMENT_TYPE: "4", ISSUERCIK: "0001819810", ISSUERNAME: "Redwire Corp", ISSUERTRADINGSYMBOL: "RDW",
          AFF10B5ONE: "0",
        }),
        blankRow(SUBMISSION, {
          ACCESSION_NUMBER: "0002-25-000001", FILING_DATE: "15-DEC-2025", DATE_OF_ORIG_SUB: "01-DEC-2025",
          DOCUMENT_TYPE: "4/A", ISSUERCIK: "0000000002", ISSUERNAME: "No Ticker Inc",
        }),
      ])
  );
  archive.file(
    "REPORTINGOWNER.tsv",
    tsv(OWNER, [
      blankRow(OWNER, {
        ACCESSION_NUMBER: "0001-25-000241", RPTOWNERCIK: "0001746356", RPTOWNERNAME: "Schena Don",
        RPTOWNER_RELATIONSHIP: "Officer", RPTOWNER_TITLE: "Chief Customer Officer",
      }),
      blankRow(OWNER, {
        ACCESSION_NUMBER: "0001-25-000241", RPTOWNERCIK: "0009999999", RPTOWNERNAME: "Fund LP",
        RPTOWNER_RELATIONSHIP: "Director, TenPercentOwner",
      }),
      blankRow(OWNER, {
        ACCESSION_NUMBER: "0002-25-000001", RPTOWNERCIK: "0000000003", RPTOWNERNAME: "Other Person",
        RPTOWNER_RELATIONSHIP: "Other", RPTOWNER_TXT: "Former officer",
      }),
    ])
  );
  archive.file(
    "NONDERIV_TRANS.tsv",
    tsv(NONDERIV, [
      blankRow(NONDERIV, {
        ACCESSION_NUMBER: "0001-25-000241", NONDERIV_TRANS_SK: "8835098", SECURITY_TITLE: "Common Stock",
        TRANS_DATE: "29-OCT-2025", TRANS_FORM_TYPE: "4", TRANS_CODE: "S", EQUITY_SWAP_INVOLVED: "0",
        TRANS_SHARES: "75974.0", TRANS_PRICEPERSHARE: "9.87", TRANS_ACQUIRED_DISP_CD: "D",
        SHRS_OWND_FOLWNG_TRANS: "288032.0", DIRECT_INDIRECT_OWNERSHIP: "D",
      }),
    ])
  );
  archive.file(
    "DERIV_TRANS.tsv",
    tsv(DERIV, [
      blankRow(DERIV, {
        ACCESSION_NUMBER: "0002-25-000001", DERIV_TRANS_SK: "3337873", SECURITY_TITLE: "Stock Option (Right to Buy)",
        CONV_EXERCISE_PRICE: "12.68", TRANS_DATE: "01-DEC-2025", TRANS_CODE: "M", TRANS_SHARES: "2449877.0",
        TRANS_PRICEPERSHARE: "0.0", TRANS_ACQUIRED_DISP_CD: "D", EXPIRATION_DATE: "31-MAR-2026",
        UNDLYNG_SEC_TITLE: "Common Shares", UNDLYNG_SEC_SHARES: "2449877.0", DIRECT_INDIRECT_OWNERSHIP: "D",
      }),
    ])
  );
  return archive.generateAsync({ type: "nodebuffer" });
}

describe("form345Dataset", () => {
  it("emits one filing row per accession and owner with relationship flags", async () => {
    const { filings } = await parseForm345Dataset(await datasetZip(), "disclosures/raw/sec345/datasets/2025q4/x.zip");
    expect(filings).toHaveLength(3);
    expect(filings[0]).toMatchObject({
      accession: "0001-25-000241",
      formType: "4",
      filingDate: "2025-10-31",
      periodOfReport: "2025-10-29",
      issuerTicker: "RDW",
      ownerName: "Schena Don",
      isOfficer: true,
      isDirector: false,
      officerTitle: "Chief Customer Officer",
      aff10b5One: false,
      availabilitySource: SEC_DATASET_AVAILABILITY_SOURCE,
      rawArchiveKey: "disclosures/raw/sec345/datasets/2025q4/x.zip",
    });
    const firstFiling = filings[0];
    if (!firstFiling) throw new Error("expected at least one filing");
    expect(firstFiling.availableAt.toISOString()).toBe("2025-11-01T03:59:59.999Z");
    expect(filings[1]).toMatchObject({ isDirector: true, isTenPercentOwner: true, isOfficer: false });
    expect(filings[2]).toMatchObject({
      isOther: true,
      ownerRelationshipText: "Former officer",
      issuerTicker: null,
      dateOfOriginalSubmission: "2025-12-01",
      aff10b5One: null,
    });
  });

  it("emits transactions once per accession with parsed numbers and dates", async () => {
    const { transactions } = await parseForm345Dataset(await datasetZip(), "key");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      rowKind: "nonderiv",
      rowSk: "8835098",
      transactionDate: "2025-10-29",
      transactionCode: "S",
      equitySwapInvolved: false,
      shares: 75974,
      pricePerShare: 9.87,
      sharesOwnedFollowing: 288032,
      acquiredDisposed: "D",
      totalValue: null,
      issuerTicker: "RDW",
    });
    expect(transactions[1]).toMatchObject({
      rowKind: "deriv",
      formType: "4/A",
      exercisePrice: 12.68,
      expirationDate: "2026-03-31",
      underlyingShares: 2449877,
      equitySwapInvolved: null,
    });
    const secondTransaction = transactions[1];
    if (!secondTransaction) throw new Error("expected at least two transactions");
    expect(secondTransaction.availableAt.toISOString()).toBe("2025-12-16T04:59:59.999Z");
  });

  it("throws on a missing column and on a row for an unknown accession", async () => {
    const withoutFilingDate = tsv(
      SUBMISSION.filter((column) => column !== "FILING_DATE"),
      []
    );
    await expect(
      parseForm345Dataset(await datasetZip({ submission: withoutFilingDate }), "key")
    ).rejects.toThrow("SUBMISSION.tsv is missing the FILING_DATE column");

    const onlyOneSubmission = tsv(SUBMISSION, [
      blankRow(SUBMISSION, {
        ACCESSION_NUMBER: "0001-25-000241", FILING_DATE: "31-OCT-2025", DOCUMENT_TYPE: "4",
        ISSUERCIK: "1", ISSUERNAME: "Redwire Corp",
      }),
    ]);
    await expect(
      parseForm345Dataset(await datasetZip({ submission: onlyOneSubmission }), "key")
    ).rejects.toThrow("references unknown accession 0002-25-000001");
  });
});
