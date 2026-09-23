import JSZip from "jszip";

import { parseThirteenFDataset, THIRTEEN_F_AVAILABILITY_SOURCE } from "./infoTable";

function tsv(header: string[], rows: string[][]): string {
  return [header.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n") + "\n";
}

const SUBMISSION = ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT"];
const COVERPAGE = [
  "ACCESSION_NUMBER", "REPORTCALENDARORQUARTER", "ISAMENDMENT", "AMENDMENTNO", "AMENDMENTTYPE",
  "FILINGMANAGER_NAME", "DATEREPORTED",
];
const INFOTABLE = [
  "ACCESSION_NUMBER", "INFOTABLE_SK", "NAMEOFISSUER", "TITLEOFCLASS", "CUSIP", "FIGI", "VALUE",
  "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL", "INVESTMENTDISCRETION", "OTHERMANAGER",
  "VOTING_AUTH_SOLE", "VOTING_AUTH_SHARED", "VOTING_AUTH_NONE",
];

function blankRow(header: string[], values: Record<string, string>): string[] {
  return header.map((column) => values[column] ?? "");
}

async function datasetZip(files: Record<string, string>): Promise<Buffer> {
  const archive = new JSZip();
  for (const [name, contents] of Object.entries(files)) archive.file(name, contents);
  return archive.generateAsync({ type: "nodebuffer" });
}

function baseFiles(): Record<string, string> {
  return {
    "SUBMISSION.tsv": tsv(SUBMISSION, [
      blankRow(SUBMISSION, {
        ACCESSION_NUMBER: "0001-26-000001", FILING_DATE: "31-MAR-2026", SUBMISSIONTYPE: "13F-HR",
        CIK: "0001234567", PERIODOFREPORT: "31-DEC-2025",
      }),
      blankRow(SUBMISSION, {
        ACCESSION_NUMBER: "0001-26-000002", FILING_DATE: "15-APR-2026", SUBMISSIONTYPE: "13F-NT",
        CIK: "0007654321", PERIODOFREPORT: "31-DEC-2025",
      }),
      blankRow(SUBMISSION, {
        ACCESSION_NUMBER: "0001-26-000003", FILING_DATE: "20-MAY-2026", SUBMISSIONTYPE: "13F-HR/A",
        CIK: "0001234567", PERIODOFREPORT: "31-DEC-2025",
      }),
    ]),
    "COVERPAGE.tsv": tsv(COVERPAGE, [
      blankRow(COVERPAGE, {
        ACCESSION_NUMBER: "0001-26-000001", REPORTCALENDARORQUARTER: "31-DEC-2025", ISAMENDMENT: "N",
        FILINGMANAGER_NAME: "Example Capital LP",
      }),
      blankRow(COVERPAGE, {
        ACCESSION_NUMBER: "0001-26-000003", REPORTCALENDARORQUARTER: "31-DEC-2025", ISAMENDMENT: "Y",
        AMENDMENTNO: "1", AMENDMENTTYPE: "NEW HOLDINGS", FILINGMANAGER_NAME: "Example Capital LP",
      }),
    ]),
    "INFOTABLE.tsv": tsv(INFOTABLE, [
      blankRow(INFOTABLE, {
        ACCESSION_NUMBER: "0001-26-000001", INFOTABLE_SK: "10", NAMEOFISSUER: "EXAMPLE CORP",
        TITLEOFCLASS: "COM", CUSIP: " 123456789 ", FIGI: "BBG000BPH459", VALUE: "1,392",
        SSHPRNAMT: "6,864", SSHPRNAMTTYPE: "SH", INVESTMENTDISCRETION: "SOLE",
        VOTING_AUTH_SOLE: "6864", VOTING_AUTH_SHARED: "0", VOTING_AUTH_NONE: "0",
      }),
      blankRow(INFOTABLE, {
        ACCESSION_NUMBER: "0001-26-000001", INFOTABLE_SK: "11", NAMEOFISSUER: "NO FIGI INC",
        TITLEOFCLASS: "COM", CUSIP: "987654321", VALUE: "100",
        SSHPRNAMT: "1000", SSHPRNAMTTYPE: "SH", PUTCALL: "Call", INVESTMENTDISCRETION: "DFND",
        VOTING_AUTH_SOLE: "0", VOTING_AUTH_SHARED: "1000", VOTING_AUTH_NONE: "0",
      }),
    ]),
  };
}

describe("parseThirteenFDataset", () => {
  it("parses filings, holdings, amendments, and notices", async () => {
    const { filings, holdings } = await parseThirteenFDataset(await datasetZip(baseFiles()), "k");
    expect(filings).toHaveLength(3);
    expect(holdings).toHaveLength(2);

    const filing = filings[0];
    if (!filing) throw new Error("expected a filing");
    expect(filing).toMatchObject({
      accession: "0001-26-000001",
      filingDate: "2026-03-31",
      availabilitySource: THIRTEEN_F_AVAILABILITY_SOURCE,
      submissionType: "13F-HR",
      cik: "0001234567",
      managerName: "Example Capital LP",
      isAmendment: false,
    });
    expect(filing.availableAt.toISOString()).toBe("2026-04-01T03:59:59.999Z");

    const amendment = filings[2];
    if (!amendment) throw new Error("expected an amendment filing");
    expect(amendment).toMatchObject({
      submissionType: "13F-HR/A",
      isAmendment: true,
      amendmentNo: "1",
      amendmentType: "NEW HOLDINGS",
    });

    const notice = filings[1];
    if (!notice) throw new Error("expected a notice filing");
    expect(notice.submissionType).toBe("13F-NT");

    const holding = holdings[0];
    if (!holding) throw new Error("expected a holding");
    expect(holding).toMatchObject({
      accession: "0001-26-000001",
      infoTableSk: "10",
      cusip: "123456789",
      figi: "BBG000BPH459",
      value: 1392,
      sharesAmount: 6864,
      discretion: "SOLE",
      votingSole: 6864,
    });

    const noFigi = holdings[1];
    if (!noFigi) throw new Error("expected a second holding");
    expect(noFigi.figi).toBeNull();
    expect(noFigi.putCall).toBe("Call");
  });

  it("reads recent windows nested under a stem directory", async () => {
    const nested: Record<string, string> = {};
    for (const [name, contents] of Object.entries(baseFiles())) nested[`01JUN2025-31AUG2025_form13f/${name}`] = contents;
    const { filings, holdings } = await parseThirteenFDataset(await datasetZip(nested), "k");
    expect(filings).toHaveLength(3);
    expect(holdings).toHaveLength(2);
  });

  it("throws on a missing column and on a holding for an unknown accession", async () => {
    const files = baseFiles();
    const broken = { ...files };
    const submissionTsv = files["SUBMISSION.tsv"];
    if (!submissionTsv) throw new Error("expected a submission fixture");
    broken["SUBMISSION.tsv"] = submissionTsv.replace("FILING_DATE\t", "");
    await expect(parseThirteenFDataset(await datasetZip(broken), "k")).rejects.toThrow(
      "SUBMISSION.tsv is missing the FILING_DATE column"
    );

    const wrongAccession = { ...baseFiles() };
    const infoTsv = wrongAccession["INFOTABLE.tsv"];
    if (!infoTsv) throw new Error("expected an infotable fixture");
    wrongAccession["INFOTABLE.tsv"] = infoTsv.replaceAll("0001-26-000001", "0009-99-999999");
    await expect(parseThirteenFDataset(await datasetZip(wrongAccession), "k")).rejects.toThrow(
      "references unknown accession 0009-99-999999"
    );
  });
});
