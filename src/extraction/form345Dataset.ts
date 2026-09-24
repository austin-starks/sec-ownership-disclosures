import JSZip from "jszip";

import { endOfDayNewYork, parseSecDatasetDate } from "../utils/disclosureDates";
import { readTsvArchive, type TsvRecord } from "./tsv";
import { resolveIssuerTicker } from "./issuerTicker";

/**
 * SEC quarterly Form 3/4/5 insider data sets into the lake's two insider tables.
 * No model is involved: the data set is SEC's own structured extract.
 *
 * `insider_filings` has one row per accession and reporting owner, so joint
 * filers appear once each. `insider_transactions` has one row per transaction of
 * an accession and does not repeat per owner, which would multiply a joint
 * filing's shares; join to owners through `accession`.
 *
 * Availability is the end of SUBMISSION.FILING_DATE in New York
 * (`sec_dataset_filing_date`). Transaction dates are never availability.
 * Columns are read by header name, and a missing column throws.
 */
export const SEC_DATASET_AVAILABILITY_SOURCE = "sec_dataset_filing_date";

export interface InsiderFilingRow {
  accession: string;
  formType: string;
  filingDate: string;
  availableAt: Date;
  availabilitySource: string;
  periodOfReport: string | null;
  dateOfOriginalSubmission: string | null;
  issuerCik: string;
  issuerName: string | null;
  issuerTicker: string | null;
  /** `issuerTicker` reduced to one joinable symbol; see `resolveIssuerTicker`. */
  resolvedTicker: string | null;
  ownerCik: string;
  ownerName: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string | null;
  ownerRelationshipText: string | null;
  aff10b5One: boolean | null;
  rawArchiveKey: string;
}

export type InsiderTransactionKind = "nonderiv" | "deriv";

export interface InsiderTransactionRow {
  accession: string;
  rowKind: InsiderTransactionKind;
  rowSk: string;
  formType: string;
  issuerCik: string;
  issuerTicker: string | null;
  resolvedTicker: string | null;
  availableAt: Date;
  availabilitySource: string;
  securityTitle: string;
  transactionDate: string | null;
  deemedExecutionDate: string | null;
  transactionFormType: string | null;
  transactionCode: string | null;
  equitySwapInvolved: boolean | null;
  acquiredDisposed: string | null;
  shares: number | null;
  pricePerShare: number | null;
  totalValue: number | null;
  sharesOwnedFollowing: number | null;
  directIndirect: string | null;
  natureOfOwnership: string | null;
  exercisePrice: number | null;
  exerciseDate: string | null;
  expirationDate: string | null;
  underlyingTitle: string | null;
  underlyingShares: number | null;
  rawArchiveKey: string;
}

export interface Form345DatasetRows {
  filings: InsiderFilingRow[];
  transactions: InsiderTransactionRow[];
}

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // Minimal gate on purpose: two decades of SEC schema drift (2006q1 has no
  // AFF10B5ONE) mean anything beyond join/identity columns is optional. The
  // text()/flag()/number() readers already tolerate blanks.
  "SUBMISSION.tsv": ["ACCESSION_NUMBER", "FILING_DATE", "DOCUMENT_TYPE", "ISSUERCIK", "ISSUERNAME"],
  "REPORTINGOWNER.tsv": [
    "ACCESSION_NUMBER",
    "RPTOWNERCIK",
    "RPTOWNERNAME",
    "RPTOWNER_RELATIONSHIP",
    "RPTOWNER_TITLE",
    "RPTOWNER_TXT",
  ],
  "NONDERIV_TRANS.tsv": [
    "ACCESSION_NUMBER",
    "NONDERIV_TRANS_SK",
    "SECURITY_TITLE",
    "TRANS_DATE",
    "DEEMED_EXECUTION_DATE",
    "TRANS_FORM_TYPE",
    "TRANS_CODE",
    "EQUITY_SWAP_INVOLVED",
    "TRANS_SHARES",
    "TRANS_PRICEPERSHARE",
    "TRANS_ACQUIRED_DISP_CD",
    "SHRS_OWND_FOLWNG_TRANS",
    "DIRECT_INDIRECT_OWNERSHIP",
    "NATURE_OF_OWNERSHIP",
  ],
  "DERIV_TRANS.tsv": [
    "ACCESSION_NUMBER",
    "DERIV_TRANS_SK",
    "SECURITY_TITLE",
    "CONV_EXERCISE_PRICE",
    "TRANS_DATE",
    "DEEMED_EXECUTION_DATE",
    "TRANS_FORM_TYPE",
    "TRANS_CODE",
    "EQUITY_SWAP_INVOLVED",
    "TRANS_SHARES",
    "TRANS_TOTAL_VALUE",
    "TRANS_PRICEPERSHARE",
    "TRANS_ACQUIRED_DISP_CD",
    "EXCERCISE_DATE",
    "EXPIRATION_DATE",
    "UNDLYNG_SEC_TITLE",
    "UNDLYNG_SEC_SHARES",
    "SHRS_OWND_FOLWNG_TRANS",
    "DIRECT_INDIRECT_OWNERSHIP",
    "NATURE_OF_OWNERSHIP",
  ],
};

/**
 * SEC's data set files are tab-delimited with no quoting, so a line is a record
 * and a tab is a field boundary. A short row reads its missing trailing fields as
 * blank.
 */
async function readTsv(archive: JSZip, name: string): Promise<TsvRecord[]> {
  return readTsvArchive(archive, name, "Form 3/4/5 data set", REQUIRED_COLUMNS[name] ?? []);
}

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function number(value: string | undefined, context: string): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Non-numeric ${context}: "${trimmed}"`);
  return parsed;
}

function required(value: string | undefined, context: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new Error(`Missing ${context}`);
  return trimmed;
}

function flag(value: string | undefined): boolean | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return null;
}

function relationshipCodes(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((code) => code.replace(/\s/g, "").toUpperCase())
      .filter(Boolean)
  );
}

interface SubmissionFacts {
  formType: string;
  issuerCik: string;
  issuerTicker: string | null;
  resolvedTicker: string | null;
  availableAt: Date;
}

export async function parseForm345Dataset(
  zip: Buffer,
  rawArchiveKey: string
): Promise<Form345DatasetRows> {
  const archive = await JSZip.loadAsync(zip);
  const [submissions, owners, nonderiv, deriv] = await Promise.all([
    readTsv(archive, "SUBMISSION.tsv"),
    readTsv(archive, "REPORTINGOWNER.tsv"),
    readTsv(archive, "NONDERIV_TRANS.tsv"),
    readTsv(archive, "DERIV_TRANS.tsv"),
  ]);

  const submissionByAccession = new Map<string, TsvRecord>();
  const factsByAccession = new Map<string, SubmissionFacts>();
  for (const submission of submissions) {
    const accession = required(submission.ACCESSION_NUMBER, "SUBMISSION ACCESSION_NUMBER");
    const filingDate = parseSecDatasetDate(submission.FILING_DATE);
    if (!filingDate) throw new Error(`Submission ${accession} has no FILING_DATE`);
    submissionByAccession.set(accession, submission);
    factsByAccession.set(accession, {
      formType: required(submission.DOCUMENT_TYPE, `SUBMISSION DOCUMENT_TYPE ${accession}`),
      issuerCik: required(submission.ISSUERCIK, `SUBMISSION ISSUERCIK ${accession}`),
      issuerTicker: text(submission.ISSUERTRADINGSYMBOL),
      resolvedTicker: resolveIssuerTicker(text(submission.ISSUERTRADINGSYMBOL)),
      availableAt: endOfDayNewYork(filingDate),
    });
  }
  const factsFor = (accession: string, table: string): SubmissionFacts => {
    const facts = factsByAccession.get(accession);
    if (!facts) throw new Error(`${table} row references unknown accession ${accession}`);
    return facts;
  };

  const filings = owners.map((owner): InsiderFilingRow => {
    const accession = required(owner.ACCESSION_NUMBER, "REPORTINGOWNER ACCESSION_NUMBER");
    const facts = factsFor(accession, "REPORTINGOWNER");
    const submission = submissionByAccession.get(accession) as TsvRecord;
    const codes = relationshipCodes(owner.RPTOWNER_RELATIONSHIP);
    return {
      accession,
      formType: facts.formType,
      filingDate: parseSecDatasetDate(submission.FILING_DATE) as string,
      availableAt: facts.availableAt,
      availabilitySource: SEC_DATASET_AVAILABILITY_SOURCE,
      periodOfReport: parseSecDatasetDate(submission.PERIOD_OF_REPORT),
      dateOfOriginalSubmission: parseSecDatasetDate(submission.DATE_OF_ORIG_SUB),
      issuerCik: facts.issuerCik,
      issuerName: text(submission.ISSUERNAME),
      issuerTicker: facts.issuerTicker,
      resolvedTicker: facts.resolvedTicker,
      ownerCik: required(owner.RPTOWNERCIK, `REPORTINGOWNER RPTOWNERCIK ${accession}`),
      ownerName: text(owner.RPTOWNERNAME),
      isDirector: codes.has("DIRECTOR"),
      isOfficer: codes.has("OFFICER"),
      isTenPercentOwner: codes.has("TENPERCENTOWNER"),
      isOther: codes.has("OTHER"),
      officerTitle: text(owner.RPTOWNER_TITLE),
      ownerRelationshipText: text(owner.RPTOWNER_TXT),
      aff10b5One: flag(submission.AFF10B5ONE),
      rawArchiveKey,
    };
  });

  const transactionBase = (record: TsvRecord, rowKind: InsiderTransactionKind, rowSk: string) => {
    const accession = required(record.ACCESSION_NUMBER, "transaction ACCESSION_NUMBER");
    const facts = factsFor(accession, rowKind === "nonderiv" ? "NONDERIV_TRANS" : "DERIV_TRANS");
    const context = `${rowKind} ${accession}/${rowSk}`;
    return {
      accession,
      rowKind,
      rowSk,
      formType: facts.formType,
      issuerCik: facts.issuerCik,
      issuerTicker: facts.issuerTicker,
      resolvedTicker: facts.resolvedTicker,
      availableAt: facts.availableAt,
      availabilitySource: SEC_DATASET_AVAILABILITY_SOURCE,
      securityTitle: required(record.SECURITY_TITLE, `${context} SECURITY_TITLE`),
      transactionDate: parseSecDatasetDate(record.TRANS_DATE),
      deemedExecutionDate: parseSecDatasetDate(record.DEEMED_EXECUTION_DATE),
      transactionFormType: text(record.TRANS_FORM_TYPE),
      transactionCode: text(record.TRANS_CODE),
      equitySwapInvolved: flag(record.EQUITY_SWAP_INVOLVED),
      acquiredDisposed: text(record.TRANS_ACQUIRED_DISP_CD),
      shares: number(record.TRANS_SHARES, `${context} TRANS_SHARES`),
      pricePerShare: number(record.TRANS_PRICEPERSHARE, `${context} TRANS_PRICEPERSHARE`),
      sharesOwnedFollowing: number(record.SHRS_OWND_FOLWNG_TRANS, `${context} SHRS_OWND_FOLWNG_TRANS`),
      directIndirect: text(record.DIRECT_INDIRECT_OWNERSHIP),
      natureOfOwnership: text(record.NATURE_OF_OWNERSHIP),
      rawArchiveKey,
    };
  };

  const transactions: InsiderTransactionRow[] = [
    ...nonderiv.map(
      (record): InsiderTransactionRow => ({
        ...transactionBase(record, "nonderiv", required(record.NONDERIV_TRANS_SK, "NONDERIV_TRANS_SK")),
        totalValue: null,
        exercisePrice: null,
        exerciseDate: null,
        expirationDate: null,
        underlyingTitle: null,
        underlyingShares: null,
      })
    ),
    ...deriv.map((record): InsiderTransactionRow => {
      const rowSk = required(record.DERIV_TRANS_SK, "DERIV_TRANS_SK");
      const context = `deriv ${required(record.ACCESSION_NUMBER, "DERIV ACCESSION_NUMBER")}/${rowSk}`;
      return {
        ...transactionBase(record, "deriv", rowSk),
        totalValue: number(record.TRANS_TOTAL_VALUE, `${context} TRANS_TOTAL_VALUE`),
        exercisePrice: number(record.CONV_EXERCISE_PRICE, `${context} CONV_EXERCISE_PRICE`),
        exerciseDate: parseSecDatasetDate(record.EXCERCISE_DATE),
        expirationDate: parseSecDatasetDate(record.EXPIRATION_DATE),
        underlyingTitle: text(record.UNDLYNG_SEC_TITLE),
        underlyingShares: number(record.UNDLYNG_SEC_SHARES, `${context} UNDLYNG_SEC_SHARES`),
      };
    }),
  ];

  return { filings, transactions };
}
