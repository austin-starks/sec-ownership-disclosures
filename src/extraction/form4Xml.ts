import { load, type Cheerio } from "cheerio";
import type { Element } from "domhandler";
import moment from "moment-timezone";

import { AVAILABILITY_EPSILON_MS } from "../sources/filingAvailability";
import { parseEdgarAcceptanceDateTime } from "../utils/disclosureDates";
import { resolveIssuerTicker } from "./issuerTicker";
import type {
  Form345DatasetRows,
  InsiderFilingRow,
  InsiderTransactionKind,
  InsiderTransactionRow,
} from "./form345Dataset";

/**
 * One EDGAR Form 3/4/5 submission (`edgar/data/{cik}/{accession}.txt`) into the
 * same insider rows the quarterly data sets produce, for the days those data sets
 * do not cover yet. No model is involved.
 *
 * Element names follow SEC's EDGAR Ownership XML schemas (technical specification
 * v5.1: `ownershipDocumentCommon`, `ownership4Document`, `ownership4ADocument`)
 * and were checked against real submissions accepted 2026-09-11. A derivative
 * transaction states either `transactionShares` or `transactionTotalValue`; an
 * element that carries only a footnote reference reads as null.
 *
 * `availableAt` is the header's `<ACCEPTANCE-DATETIME>` (New York clock time)
 * plus `AVAILABILITY_EPSILON_MS`, so a filing accepted exactly at a bar's
 * timestamp is not visible in that bar (`sec_acceptance_datetime`). XML carries no
 * surrogate key, so `rowSk` is the row's 1-based position within its table.
 */
export const SEC_ACCEPTANCE_AVAILABILITY_SOURCE = "sec_acceptance_datetime";

const DOCUMENT_OPEN = "<ownershipDocument";
const DOCUMENT_CLOSE = "</ownershipDocument>";

function headerField(submission: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(submission);
  const value = match?.[1];
  if (!match || value === undefined) throw new Error(`EDGAR submission header is missing ${label}`);
  return value.trim();
}

function compactDate(raw: string, label: string): string {
  const parsed = moment.utc(raw, "YYYYMMDD", true);
  if (!parsed.isValid()) throw new Error(`Unrecognized ${label}: "${raw}"`);
  return parsed.format("YYYY-MM-DD");
}

/** An xs:date may carry a zone offset ("2026-09-08-05:00"); the calendar date is its first ten characters. */
function xmlDate(raw: string | null, label: string): string | null {
  if (raw === null) return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !moment.utc(day, "YYYY-MM-DD", true).isValid()) {
    throw new Error(`Unrecognized ${label}: "${raw}"`);
  }
  return day;
}

function childText(node: Cheerio<Element>, path: readonly string[]): string | null {
  let current = node;
  for (const name of path) current = current.children(name);
  if (current.length === 0) return null;
  const value = current.first().text().trim();
  return value ? value : null;
}

function childNumber(node: Cheerio<Element>, path: readonly string[], context: string): number | null {
  const raw = childText(node, path);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Non-numeric ${context} ${path.join("/")}: "${raw}"`);
  return parsed;
}

function childFlag(node: Cheerio<Element>, path: readonly string[]): boolean | null {
  const raw = childText(node, path)?.toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
}

export function parseEdgarOwnershipSubmission(
  submission: string,
  rawArchiveKey: string
): Form345DatasetRows {
  const accession = headerField(submission, /^ACCESSION NUMBER:\s*(\S+)/m, "ACCESSION NUMBER");
  const acceptedAt = parseEdgarAcceptanceDateTime(
    headerField(submission, /<ACCEPTANCE-DATETIME>(\d{14})/, "ACCEPTANCE-DATETIME")
  );
  const filingDate = compactDate(
    headerField(submission, /^FILED AS OF DATE:\s*(\d{8})/m, "FILED AS OF DATE"),
    `${accession} FILED AS OF DATE`
  );
  const start = submission.indexOf(DOCUMENT_OPEN);
  const end = submission.indexOf(DOCUMENT_CLOSE);
  if (start < 0 || end < start) throw new Error(`EDGAR submission ${accession} has no ownershipDocument`);
  const $ = load(submission.slice(start, end + DOCUMENT_CLOSE.length), { xmlMode: true });
  const document = $("ownershipDocument").first();

  const formType = childText(document, ["documentType"]);
  const issuerCik = childText(document, ["issuer", "issuerCik"]);
  const issuerName = childText(document, ["issuer", "issuerName"]);
  if (!formType || !issuerCik || !issuerName) {
    throw new Error(`ownershipDocument ${accession} is missing documentType, issuerCik or issuerName`);
  }
  const issuerTicker = childText(document, ["issuer", "issuerTradingSymbol"]);
  const resolvedTicker = resolveIssuerTicker(issuerTicker);
  const availableAt = new Date(acceptedAt.getTime() + AVAILABILITY_EPSILON_MS);

  const filings = document
    .children("reportingOwner")
    .toArray()
    .map((element): InsiderFilingRow => {
      const owner = $(element);
      const ownerCik = childText(owner, ["reportingOwnerId", "rptOwnerCik"]);
      const ownerName = childText(owner, ["reportingOwnerId", "rptOwnerName"]);
      if (!ownerCik || !ownerName) throw new Error(`ownershipDocument ${accession} has an owner without CIK or name`);
      const relationship = (name: string): string[] => ["reportingOwnerRelationship", name];
      return {
        accession,
        formType,
        filingDate,
        availableAt,
        availabilitySource: SEC_ACCEPTANCE_AVAILABILITY_SOURCE,
        periodOfReport: xmlDate(childText(document, ["periodOfReport"]), `${accession} periodOfReport`),
        dateOfOriginalSubmission: xmlDate(
          childText(document, ["dateOfOriginalSubmission"]),
          `${accession} dateOfOriginalSubmission`
        ),
        issuerCik,
        issuerName,
        issuerTicker,
        resolvedTicker,
        ownerCik,
        ownerName,
        isDirector: childFlag(owner, relationship("isDirector")) === true,
        isOfficer: childFlag(owner, relationship("isOfficer")) === true,
        isTenPercentOwner: childFlag(owner, relationship("isTenPercentOwner")) === true,
        isOther: childFlag(owner, relationship("isOther")) === true,
        officerTitle: childText(owner, relationship("officerTitle")),
        ownerRelationshipText: childText(owner, relationship("otherText")),
        aff10b5One: childFlag(document, ["aff10b5One"]),
        rawArchiveKey,
      };
    });
  if (filings.length === 0) throw new Error(`ownershipDocument ${accession} has no reportingOwner`);

  const transactions = (kind: InsiderTransactionKind, table: string, rowElement: string): InsiderTransactionRow[] =>
    document
      .children(table)
      .children(rowElement)
      .toArray()
      .map((element, index): InsiderTransactionRow => {
        const row = $(element);
        const rowSk = String(index + 1);
        const context = `${kind} ${accession}/${rowSk}`;
        const securityTitle = childText(row, ["securityTitle", "value"]);
        if (!securityTitle) throw new Error(`${context} has no securityTitle`);
        const derivative = kind === "deriv";
        return {
          accession,
          rowKind: kind,
          rowSk,
          formType,
          issuerCik,
          issuerTicker,
          resolvedTicker,
          availableAt,
          availabilitySource: SEC_ACCEPTANCE_AVAILABILITY_SOURCE,
          securityTitle,
          transactionDate: xmlDate(childText(row, ["transactionDate", "value"]), `${context} transactionDate`),
          deemedExecutionDate: xmlDate(
            childText(row, ["deemedExecutionDate", "value"]),
            `${context} deemedExecutionDate`
          ),
          transactionFormType: childText(row, ["transactionCoding", "transactionFormType"]),
          transactionCode: childText(row, ["transactionCoding", "transactionCode"]),
          equitySwapInvolved: childFlag(row, ["transactionCoding", "equitySwapInvolved"]),
          acquiredDisposed: childText(row, ["transactionAmounts", "transactionAcquiredDisposedCode", "value"]),
          shares: childNumber(row, ["transactionAmounts", "transactionShares", "value"], context),
          pricePerShare: childNumber(row, ["transactionAmounts", "transactionPricePerShare", "value"], context),
          totalValue: derivative
            ? childNumber(row, ["transactionAmounts", "transactionTotalValue", "value"], context)
            : null,
          sharesOwnedFollowing: childNumber(
            row,
            ["postTransactionAmounts", "sharesOwnedFollowingTransaction", "value"],
            context
          ),
          directIndirect: childText(row, ["ownershipNature", "directOrIndirectOwnership", "value"]),
          natureOfOwnership: childText(row, ["ownershipNature", "natureOfOwnership", "value"]),
          exercisePrice: derivative ? childNumber(row, ["conversionOrExercisePrice", "value"], context) : null,
          exerciseDate: derivative
            ? xmlDate(childText(row, ["exerciseDate", "value"]), `${context} exerciseDate`)
            : null,
          expirationDate: derivative
            ? xmlDate(childText(row, ["expirationDate", "value"]), `${context} expirationDate`)
            : null,
          underlyingTitle: derivative
            ? childText(row, ["underlyingSecurity", "underlyingSecurityTitle", "value"])
            : null,
          underlyingShares: derivative
            ? childNumber(row, ["underlyingSecurity", "underlyingSecurityShares", "value"], context)
            : null,
          rawArchiveKey,
        };
      });

  return {
    filings,
    transactions: [
      ...transactions("nonderiv", "nonDerivativeTable", "nonDerivativeTransaction"),
      ...transactions("deriv", "derivativeTable", "derivativeTransaction"),
    ],
  };
}
