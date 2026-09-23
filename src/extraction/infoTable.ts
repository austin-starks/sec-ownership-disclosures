import JSZip from "jszip";

import { endOfDayNewYork, parseSecDatasetDate } from "../utils/disclosureDates";
import { readTsvArchive, type TsvRecord } from "./tsv";

export const THIRTEEN_F_AVAILABILITY_SOURCE = "sec_13f_quarterly_dataset";

/**
 * One 13F submission: the manager, the report period, and the amendment
 * signal. Amendments (`13F-HR/A`, `ISAMENDMENT Y`) are separate rows with
 * their own `availableAt` — originals are never overwritten, the same
 * versioning the insider tables use.
 */
export interface ThirteenFFilingRow {
  accession: string;
  filingDate: string;
  availableAt: Date;
  availabilitySource: string;
  submissionType: string;
  cik: string;
  managerName: string | null;
  periodOfReport: string | null;
  reportCalendarOrQuarter: string | null;
  isAmendment: boolean | null;
  amendmentNo: string | null;
  amendmentType: string | null;
  dateReported: string | null;
  rawArchiveKey: string;
}

/**
 * One holdings row. `cusip` is normalized (no spaces, uppercase) but never
 * resolved to a ticker here — mapping is the milestone-3 CUSIP job, and
 * `figi` is only ~12% filled at source. `value` is as reported, in thousands
 * of USD per the FORM13F readme.
 */
export interface ThirteenFHoldingRow {
  accession: string;
  infoTableSk: string;
  availableAt: Date;
  availabilitySource: string;
  issuerName: string | null;
  titleOfClass: string | null;
  cusip: string;
  figi: string | null;
  value: number | null;
  sharesAmount: number | null;
  sharesType: string | null;
  putCall: string | null;
  discretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
  rawArchiveKey: string;
}

export interface ThirteenFDatasetRows {
  filings: ThirteenFFilingRow[];
  holdings: ThirteenFHoldingRow[];
}

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "SUBMISSION.tsv": ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT"],
  "COVERPAGE.tsv": ["ACCESSION_NUMBER", "ISAMENDMENT", "FILINGMANAGER_NAME"],
  "INFOTABLE.tsv": [
    "ACCESSION_NUMBER", "INFOTABLE_SK", "NAMEOFISSUER", "TITLEOFCLASS", "CUSIP",
    "FIGI", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL", "INVESTMENTDISCRETION",
    "VOTING_AUTH_SOLE", "VOTING_AUTH_SHARED", "VOTING_AUTH_NONE",
  ],
};

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function required(value: string | undefined, context: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new Error(`Missing ${context}`);
  return trimmed;
}

function numeric(value: string | undefined, context: string): number | null {
  const trimmed = (value ?? "").trim().replace(/,/g, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Non-numeric ${context}: "${trimmed}"`);
  return parsed;
}

function flagYesNo(value: string | undefined): boolean | null {
  const trimmed = (value ?? "").trim().toUpperCase();
  if (trimmed === "Y") return true;
  if (trimmed === "N") return false;
  return null;
}

function normalizeCusip(value: string | undefined, context: string): string {
  return required(value, context).replace(/\s/g, "").toUpperCase();
}

/**
 * Classic quarters keep TSVs at the archive root; recent acceptance windows
 * nest them under one `{STEM}/` directory. The prefix is detected, never
 * assumed — assuming flat broke on the first 2025 window.
 */
async function thirteenFDirPrefix(archive: JSZip): Promise<string> {
  const names = Object.keys(archive.files).filter((name) => archive.files[name]?.dir !== true);
  if (names.includes("SUBMISSION.tsv")) return "";
  const nested = names.filter((name) => name.endsWith("/SUBMISSION.tsv"));
  if (nested.length === 1 && nested[0]) return nested[0].slice(0, -"SUBMISSION.tsv".length);
  throw new Error(`Form 13F data set has no single SUBMISSION.tsv (${nested.length} candidates)`);
}

export async function parseThirteenFDataset(zip: Buffer, rawArchiveKey: string): Promise<ThirteenFDatasetRows> {
  const archive = await JSZip.loadAsync(zip);
  const prefix = await thirteenFDirPrefix(archive);
  const [submissions, coverpages, infotable] = await Promise.all([
    readTsvArchive(archive, `${prefix}SUBMISSION.tsv`, "Form 13F data set", REQUIRED_COLUMNS["SUBMISSION.tsv"] ?? []),
    readTsvArchive(archive, `${prefix}COVERPAGE.tsv`, "Form 13F data set", REQUIRED_COLUMNS["COVERPAGE.tsv"] ?? []),
    readTsvArchive(archive, `${prefix}INFOTABLE.tsv`, "Form 13F data set", REQUIRED_COLUMNS["INFOTABLE.tsv"] ?? []),
  ]);

  const coverByAccession = new Map<string, TsvRecord>();
  for (const cover of coverpages) {
    const accession = required(cover.ACCESSION_NUMBER, "COVERPAGE ACCESSION_NUMBER");
    if (!coverByAccession.has(accession)) coverByAccession.set(accession, cover);
  }

  const filings = submissions.map((submission): ThirteenFFilingRow => {
    const accession = required(submission.ACCESSION_NUMBER, "SUBMISSION ACCESSION_NUMBER");
    const filingDate = parseSecDatasetDate(required(submission.FILING_DATE, `SUBMISSION FILING_DATE ${accession}`));
    if (!filingDate) {
      throw new Error(`SUBMISSION FILING_DATE ${accession} is not a date: "${submission.FILING_DATE ?? ""}"`);
    }
    const cover = coverByAccession.get(accession);
    return {
      accession,
      filingDate,
      availableAt: endOfDayNewYork(filingDate),
      availabilitySource: THIRTEEN_F_AVAILABILITY_SOURCE,
      submissionType: required(submission.SUBMISSIONTYPE, `SUBMISSION SUBMISSIONTYPE ${accession}`),
      cik: required(submission.CIK, `SUBMISSION CIK ${accession}`),
      managerName: text(cover?.FILINGMANAGER_NAME),
      periodOfReport: parseSecDatasetDate(submission.PERIODOFREPORT),
      reportCalendarOrQuarter: text(cover?.REPORTCALENDARORQUARTER),
      isAmendment: flagYesNo(cover?.ISAMENDMENT),
      amendmentNo: text(cover?.AMENDMENTNO),
      amendmentType: text(cover?.AMENDMENTTYPE),
      dateReported: parseSecDatasetDate(cover?.DATEREPORTED),
      rawArchiveKey,
    };
  });

  const availableByAccession = new Map<string, Date>();
  for (const filing of filings) {
    if (!availableByAccession.has(filing.accession)) availableByAccession.set(filing.accession, filing.availableAt);
  }

  const holdings = infotable.map((record): ThirteenFHoldingRow => {
    const accession = required(record.ACCESSION_NUMBER, "INFOTABLE ACCESSION_NUMBER");
    const availableAt = availableByAccession.get(accession);
    if (!availableAt) throw new Error(`INFOTABLE row references unknown accession ${accession}`);
    const context = `${accession}/${record.INFOTABLE_SK ?? "?"}`;
    return {
      accession,
      infoTableSk: required(record.INFOTABLE_SK, `${context} INFOTABLE_SK`),
      availableAt,
      availabilitySource: THIRTEEN_F_AVAILABILITY_SOURCE,
      issuerName: text(record.NAMEOFISSUER),
      titleOfClass: text(record.TITLEOFCLASS),
      cusip: normalizeCusip(record.CUSIP, `${context} CUSIP`),
      figi: text(record.FIGI),
      value: numeric(record.VALUE, `${context} VALUE`),
      sharesAmount: numeric(record.SSHPRNAMT, `${context} SSHPRNAMT`),
      sharesType: text(record.SSHPRNAMTTYPE),
      putCall: text(record.PUTCALL),
      discretion: text(record.INVESTMENTDISCRETION),
      otherManager: text(record.OTHERMANAGER),
      votingSole: numeric(record.VOTING_AUTH_SOLE, `${context} VOTING_AUTH_SOLE`),
      votingShared: numeric(record.VOTING_AUTH_SHARED, `${context} VOTING_AUTH_SHARED`),
      votingNone: numeric(record.VOTING_AUTH_NONE, `${context} VOTING_AUTH_NONE`),
      rawArchiveKey,
    };
  });

  return { filings, holdings };
}
