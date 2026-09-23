import { ShardRowReader } from "../utils/shardRowFields";
import type { ThirteenFFilingRow, ThirteenFHoldingRow } from "../extraction/infoTable";

/** An `institutional_filings` row read back from its shard, validated field by field. */
export function institutionalFilingFromShard(raw: Record<string, unknown>): ThirteenFFilingRow {
  const row = new ShardRowReader("institutional_filings", raw);
  return {
    accession: row.text("accession"),
    filingDate: row.text("filingDate"),
    availableAt: row.date("availableAt"),
    availabilitySource: row.text("availabilitySource"),
    submissionType: row.text("submissionType"),
    cik: row.text("cik"),
    managerName: row.textOrNull("managerName"),
    periodOfReport: row.textOrNull("periodOfReport"),
    reportCalendarOrQuarter: row.textOrNull("reportCalendarOrQuarter"),
    isAmendment: row.booleanOrNull("isAmendment"),
    amendmentNo: row.textOrNull("amendmentNo"),
    amendmentType: row.textOrNull("amendmentType"),
    dateReported: row.textOrNull("dateReported"),
    rawArchiveKey: row.text("rawArchiveKey"),
  };
}

/** An `institutional_holdings` row read back from its shard, validated field by field. */
export function institutionalHoldingFromShard(raw: Record<string, unknown>): ThirteenFHoldingRow {
  const row = new ShardRowReader("institutional_holdings", raw);
  return {
    accession: row.text("accession"),
    infoTableSk: row.text("infoTableSk"),
    availableAt: row.date("availableAt"),
    availabilitySource: row.text("availabilitySource"),
    issuerName: row.textOrNull("issuerName"),
    titleOfClass: row.textOrNull("titleOfClass"),
    cusip: row.text("cusip"),
    figi: row.textOrNull("figi"),
    value: row.numberOrNull("value"),
    sharesAmount: row.numberOrNull("sharesAmount"),
    sharesType: row.textOrNull("sharesType"),
    putCall: row.textOrNull("putCall"),
    discretion: row.textOrNull("discretion"),
    otherManager: row.textOrNull("otherManager"),
    votingSole: row.numberOrNull("votingSole"),
    votingShared: row.numberOrNull("votingShared"),
    votingNone: row.numberOrNull("votingNone"),
    resolvedTicker: row.textOrNull("resolvedTicker"),
    valueUnitSource: row.textOrNull("valueUnitSource"),
    rawArchiveKey: row.text("rawArchiveKey"),
  };
}
