import { ShardRowReader } from "../utils/shardRowFields";
import type { InsiderFilingRow, InsiderTransactionRow } from "../extraction/form345Dataset";
import { resolveIssuerTicker } from "../extraction/issuerTicker";

const ROW_KINDS = ["nonderiv", "deriv"] as const;

/** Shards published before 0.4.0 have no `resolvedTicker`; derive it the same way. */
function resolvedTickerOf(raw: Record<string, unknown>, row: ShardRowReader): string | null {
  return "resolvedTicker" in raw ? row.textOrNull("resolvedTicker") : resolveIssuerTicker(row.textOrNull("issuerTicker"));
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
