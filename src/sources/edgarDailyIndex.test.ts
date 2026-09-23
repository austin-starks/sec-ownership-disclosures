import { insiderIndexEntries, parseEdgarDailyFormIndex } from "./edgarDailyIndex";

const PREAMBLE = [
  "Description:           Daily Index of EDGAR Dissemination Feed by Form Type",
  "Last Data Received:    Sep 11, 2026",
  "Comments:              webmaster@sec.gov",
  "Anonymous FTP:         ftp://ftp.sec.gov/edgar/",
  " ",
  " ",
  "Form Type   Company Name                                                  CIK         Date Filed  File Name",
  "---------------------------------------------------------------------------------------------------------------------------------------------",
];

const LINES = [
  "1-A POS          McQueen Labs Series, LLC                                      2025795     20260911    edgar/data/2025795/0001493152-26-042361.txt                                                ",
  "4                10x Genomics, Inc.                                            1770787     20260911    edgar/data/1770787/0001610717-26-000414.txt                                                ",
  "4/A              AFLAC INC                                                     4977        20260911    edgar/data/4977/0001104659-26-107065.txt",
  "3                Smith  John Q                                                 1971187     20260911    edgar/data/1971187/0000905148-26-004140.txt",
  "",
];

describe("edgarDailyIndex", () => {
  it("reads every filing line from the right-hand columns inward", () => {
    const entries = parseEdgarDailyFormIndex([...PREAMBLE, ...LINES].join("\n"));
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ formType: "1-A POS", companyName: "McQueen Labs Series, LLC", cik: "2025795" });
    expect(entries[1]).toEqual({
      formType: "4",
      companyName: "10x Genomics, Inc.",
      cik: "1770787",
      dateFiled: "2026-09-11",
      fileName: "edgar/data/1770787/0001610717-26-000414.txt",
      accession: "0001610717-26-000414",
    });
    const fourth = entries[3];
    if (!fourth) throw new Error("expected at least four entries");
    expect(fourth.companyName).toBe("Smith  John Q");
  });

  it("keeps only Form 3, 4 and 5 filings and their amendments", () => {
    const entries = insiderIndexEntries(parseEdgarDailyFormIndex([...PREAMBLE, ...LINES].join("\n")));
    expect(entries.map((entry) => entry.formType)).toEqual(["4", "4/A", "3"]);
  });

  it("throws when the format changes instead of returning nothing", () => {
    expect(() => parseEdgarDailyFormIndex(LINES.join("\n"))).toThrow("no header separator");
    expect(() => parseEdgarDailyFormIndex([...PREAMBLE, "4 garbage"].join("\n"))).toThrow(
      "Unrecognized EDGAR daily index line"
    );
  });
});
