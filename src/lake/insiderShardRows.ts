import { ShardRowReader } from "../utils/shardRowFields";
import type { InsiderFilingRow, InsiderTransactionRow } from "../extraction/form345Dataset";
import {
  INSIDER_CEO_CLASSIFIER_VERSION,
  INSIDER_CEO_TITLE_RULE,
  insiderCeoColumns,
} from "../extraction/insiderOfficerTitle";
import { resolveIssuerTicker } from "../extraction/issuerTicker";

const ROW_KINDS = ["nonderiv", "deriv"] as const;

/** Shards published before 0.4.0 have no `resolvedTicker`; derive it the same way. */
function resolvedTickerOf(raw: Record<string, unknown>, row: ShardRowReader): string | null {
  return "resolvedTicker" in raw ? row.textOrNull("resolvedTicker") : resolveIssuerTicker(row.textOrNull("issuerTicker"));
}

const CEO_TITLE_RULE_VERSION = /^ceo-title(\d+)$/;

/**
 * The `isCeo` and `ceoTitleRule` a stored `insider_filings` row carries under the current rule. A row written
 * by the current rule is read as stored. Shards published before 0.5.0 have no `isCeo`, and a shard stamped by
 * an earlier rule holds that rule's reading: both are derived again from the row's own `officerTitle`, so a
 * republished year carries one rule. A row stamped by a newer rule than this package knows throws rather than
 * being downgraded. The SQLite build fills the same columns through this function.
 */
export function insiderFilingCeoColumnsFromShard(raw: Record<string, unknown>): Pick<InsiderFilingRow, "isCeo" | "ceoTitleRule"> {
  const row = new ShardRowReader("insider_filings", raw);
  const rule = "ceoTitleRule" in raw ? row.textOrNull("ceoTitleRule") : null;
  if (rule === INSIDER_CEO_TITLE_RULE) return { isCeo: row.boolean("isCeo"), ceoTitleRule: rule };
  if (rule !== null) {
    const version = CEO_TITLE_RULE_VERSION.exec(rule)?.[1];
    if (version === undefined) throw new Error(`insider_filings row has an unexpected ceoTitleRule: ${JSON.stringify(rule)}`);
    if (Number(version) > INSIDER_CEO_CLASSIFIER_VERSION) {
      throw new Error(
        `insider_filings row was classified by ${rule}, newer than this package's ${INSIDER_CEO_TITLE_RULE}; ` +
          "upgrade sec-ownership-disclosures to read it"
      );
    }
  }
  return insiderCeoColumns(row.textOrNull("officerTitle"));
}

/** An `insider_filings` row read back from its shard, validated field by field. */
export function insiderFilingFromShard(raw: Record<string, unknown>): InsiderFilingRow {
  const row = new ShardRowReader("insider_filings", raw);
  return {
    accession: row.text("accession"),
    formType: row.text("formType"),
    filingDate: row.text("filingDate"),
    availableAt: row.date("availableAt"),
    availabilitySource: row.text("availabilitySource"),
    periodOfReport: row.textOrNull("periodOfReport"),
    dateOfOriginalSubmission: row.textOrNull("dateOfOriginalSubmission"),
    issuerCik: row.text("issuerCik"),
    issuerName: row.textOrNull("issuerName"),
    issuerTicker: row.textOrNull("issuerTicker"),
    resolvedTicker: resolvedTickerOf(raw, row),
    ownerCik: row.text("ownerCik"),
    ownerName: row.textOrNull("ownerName"),
    isDirector: row.boolean("isDirector"),
    isOfficer: row.boolean("isOfficer"),
    isTenPercentOwner: row.boolean("isTenPercentOwner"),
    isOther: row.boolean("isOther"),
    officerTitle: row.textOrNull("officerTitle"),
    ownerRelationshipText: row.textOrNull("ownerRelationshipText"),
    aff10b5One: row.booleanOrNull("aff10b5One"),
    rawArchiveKey: row.text("rawArchiveKey"),
    ...insiderFilingCeoColumnsFromShard(raw),
  };
}

/** An `insider_transactions` row read back from its shard, validated field by field. */
export function insiderTransactionFromShard(raw: Record<string, unknown>): InsiderTransactionRow {
  const row = new ShardRowReader("insider_transactions", raw);
  return {
    accession: row.text("accession"),
    rowKind: row.oneOf("rowKind", ROW_KINDS),
    rowSk: row.text("rowSk"),
    formType: row.text("formType"),
    issuerCik: row.text("issuerCik"),
    issuerTicker: row.textOrNull("issuerTicker"),
    resolvedTicker: resolvedTickerOf(raw, row),
    availableAt: row.date("availableAt"),
    availabilitySource: row.text("availabilitySource"),
    securityTitle: row.text("securityTitle"),
    transactionDate: row.textOrNull("transactionDate"),
    deemedExecutionDate: row.textOrNull("deemedExecutionDate"),
    transactionFormType: row.textOrNull("transactionFormType"),
    transactionCode: row.textOrNull("transactionCode"),
    equitySwapInvolved: row.booleanOrNull("equitySwapInvolved"),
    acquiredDisposed: row.textOrNull("acquiredDisposed"),
    shares: row.numberOrNull("shares"),
    pricePerShare: row.numberOrNull("pricePerShare"),
    totalValue: row.numberOrNull("totalValue"),
    sharesOwnedFollowing: row.numberOrNull("sharesOwnedFollowing"),
    directIndirect: row.textOrNull("directIndirect"),
    natureOfOwnership: row.textOrNull("natureOfOwnership"),
    exercisePrice: row.numberOrNull("exercisePrice"),
    exerciseDate: row.textOrNull("exerciseDate"),
    expirationDate: row.textOrNull("expirationDate"),
    underlyingTitle: row.textOrNull("underlyingTitle"),
    underlyingShares: row.numberOrNull("underlyingShares"),
    rawArchiveKey: row.text("rawArchiveKey"),
  };
}
