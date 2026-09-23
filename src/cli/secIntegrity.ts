#!/usr/bin/env node
/**
 * Integrity audit over archived raw quarters: re-parse every raw ZIP (never
 * the backfill's own counts), run the window checks, and account
 * cross-window structure — filing-date boundaries for Form 3/4/5 (expected
 * disjoint), accession unions for 13F (structural overlap expected).
 *
 * DRY RUN by default: prints the report, writes nothing. `--run` writes the
 * report JSON next to the round receipts.
 *
 * Usage:
 *   node dist/cli/secIntegrity.js --dataset form345 --round backfill-2026-09-22-form345 --run
 */
import { FileDataStore } from "../backfill/adapters/filesystem";
import { S3DataStore } from "../backfill/adapters/s3-data-store";
import { createReceiptStore } from "../backfill/receipts";
import type { DataStore } from "../backfill/ports";
import { parseForm345Dataset } from "../extraction/form345Dataset";
import { parseThirteenFDataset } from "../extraction/infoTable";
import { checkHoldingsWindow, type HoldingsWindowIntegrity } from "../integrity/holdingsChecks";
import { checkInsiderWindow, type InsiderWindowIntegrity } from "../integrity/insiderChecks";

function argValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? (argv[index + 1] as string) : null;
}

/**
 * The label is the path segment between the raw prefix and the content hash —
 * opaque to this runner, so a new naming era can never silently drop windows
 * again (the classic-`2013q2_form13f` stems did not match the old regex and 43
 * windows audited as 11 with no error).
 */
function labelFromKey(key: string, rawPrefix: string): string | null {
  if (!key.startsWith(`${rawPrefix}/`)) return null;
  const rest = key.slice(rawPrefix.length + 1);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const label = rest.slice(0, slash);
  if (!label || label.includes("..")) return null;
  return label;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dataset = argValue(argv, "--dataset");
  if (dataset !== "form345" && dataset !== "form13f") throw new Error("--dataset must be form345 or form13f");
  const storeName = argValue(argv, "--store") ?? "tigris";
  const roundId = argValue(argv, "--round") ?? "";
  if (!roundId) throw new Error("--round is required (receipts to cross-check)");
  const run = argv.includes("--run");
  const maxWindows = argValue(argv, "--max-windows") ? Number(argValue(argv, "--max-windows") as string) : null;
  const store: DataStore =
    storeName === "fs"
      ? new FileDataStore(argValue(argv, "--fs-root") ?? "/tmp/sec-backfill")
      : new S3DataStore({
          bucket: argValue(argv, "--tigris-bucket") ?? "nexustrade-parquet",
          endpoint: argValue(argv, "--tigris-endpoint") ?? "https://fly.storage.tigris.dev",
          region: "auto",
          keyPrefix: argValue(argv, "--tigris-prefix") ?? "sec-ownership",
        });

  const rawPrefix = dataset === "form345" ? "raw/sec345/datasets" : "raw/sec13f/datasets";
  const rawObjects = await store.list(rawPrefix);
  const byLabel = new Map<string, string>();
  for (const object of rawObjects) {
    const label = labelFromKey(object.key, rawPrefix);
    if (label && !byLabel.has(label)) byLabel.set(label, object.key);
  }
  let labels = [...byLabel.keys()].sort();
  if (maxWindows !== null) labels = labels.slice(0, maxWindows);

  const receipts = createReceiptStore({ store, root: "rounds", roundId });
  const finished = await receipts.finished();
  if (maxWindows === null) {
    // Every receipted window must have raw present: a silent subset audit is
    // how 43 windows once passed as 11. Fail here, not in the methodology.
    const receiptLabels = new Set(
      [...finished].map((identity) => identity.slice(identity.indexOf(":") + 1)).filter(Boolean)
    );
    const uncovered = [...receiptLabels].filter((label) => !byLabel.has(label as string));
    if (uncovered.length > 0) {
      throw new Error(
        `raw archive is missing ${uncovered.length} receipted windows, e.g. ${uncovered.slice(0, 3).join(", ")}`
      );
    }
  }

  let totalFilings = 0;
  let totalRows = 0;
  const insiderReports: InsiderWindowIntegrity[] = [];
  const holdingsReports: HoldingsWindowIntegrity[] = [];
  const unreceipted: string[] = [];
  for (const label of labels) {
    const key = byLabel.get(label) as string;
    const zip = await store.get(key);
    if (dataset === "form345") {
      const rows = await parseForm345Dataset(zip, key);
      insiderReports.push(checkInsiderWindow(label, rows));
      totalFilings += rows.filings.length;
      totalRows += rows.transactions.length;
    } else {
      const rows = await parseThirteenFDataset(zip, key);
      holdingsReports.push(checkHoldingsWindow(label, rows));
      totalFilings += rows.filings.length;
      totalRows += rows.holdings.length;
    }
    const identity = `${dataset === "form345" ? "form345" : "form13f"}:${label}`;
    if (!finished.has(identity)) unreceipted.push(identity);
    console.log(`  audited ${label}`);
  }

  // Cross-window structure.
  const boundaries = insiderReports
    .map((r) => ({ label: r.label, ...r.filingDateRange }))
    .sort((a, b) => (a.min ?? "").localeCompare(b.min ?? ""));
  const boundaryOverlaps: string[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const prev = boundaries[i - 1];
    const curr = boundaries[i];
    if (prev && curr && prev.max && curr.min && curr.min <= prev.max) {
      boundaryOverlaps.push(`${prev.label}[${prev.max}] x ${curr.label}[${curr.min}]`);
    }
  }
  const windowsByAccession = new Map<string, string[]>();
  for (const report of holdingsReports) {
    for (const accession of report.accessions) {
      const list = windowsByAccession.get(accession) ?? [];
      list.push(report.label);
      windowsByAccession.set(accession, list);
    }
  }
  let multiWindowAccessions = 0;
  for (const windows of windowsByAccession.values()) {
    if (windows.length > 1) multiWindowAccessions += 1;
  }

  const sum = <T extends object>(reports: T[], pick: (r: T) => number): number =>
    reports.reduce((total, r) => total + pick(r), 0);
  const mergeCodes = <T extends object>(reports: T[], pick: (r: T) => Record<string, number>): Record<string, number> => {
    const merged: Record<string, number> = {};
    for (const report of reports) {
      for (const [code, count] of Object.entries(pick(report))) merged[code] = (merged[code] ?? 0) + count;
    }
    return merged;
  };

  const report = {
    dataset,
    roundId,
    windows: labels.length,
    totalFilings,
    totalRows,
    distinctAccessions: dataset === "form13f" ? windowsByAccession.size : null,
    multiWindowAccessions,
    boundaryOverlaps,
    unreceiptedRaw: unreceipted,
    insider:
      dataset === "form345"
        ? {
            duplicateFilingKeys: insiderReports.flatMap((r) => r.duplicateFilingKeys).slice(0, 20),
            orphanTransactions: sum(insiderReports, (r) => r.orphanTransactions),
            transactionCodes: mergeCodes(insiderReports, (r) => r.transactionCodes),
            futureDatedTransactions: sum(insiderReports, (r) => r.futureDatedTransactions),
            nullTickerTransactions: sum(insiderReports, (r) => r.nullTickerTransactions),
            nullSharesTransactions: sum(insiderReports, (r) => r.nullSharesTransactions),
            negativeAmounts: sum(insiderReports, (r) => r.negativeAmounts),
            amendmentsWithoutOriginalDate: sum(insiderReports, (r) => r.amendmentsWithoutOriginalDate),
          }
        : null,
    holdings:
      dataset === "form13f"
        ? {
            duplicateHoldingKeys: holdingsReports.flatMap((r) => r.duplicateHoldingKeys).slice(0, 20),
            orphanHoldings: sum(holdingsReports, (r) => r.orphanHoldings),
            submissionTypes: mergeCodes(holdingsReports, (r) => r.submissionTypes),
            noticeFilingsWithHoldings: sum(holdingsReports, (r) => r.noticeFilingsWithHoldings),
            nullManagerFilings: sum(holdingsReports, (r) => r.nullManagerFilings),
            nullIssuerHoldings: sum(holdingsReports, (r) => r.nullIssuerHoldings),
            zeroPositionHoldings: sum(holdingsReports, (r) => r.zeroPositionHoldings),
            placeholderCusips: sum(holdingsReports, (r) => r.placeholderCusips),
            figiCoverage: sum(holdingsReports, (r) => r.figiCoverage),
            putCall: mergeCodes(holdingsReports, (r) => r.putCall),
          }
        : null,
  };

  console.log(JSON.stringify(report, null, 1));
  if (run) {
    // Reports live OUTSIDE the round receipts prefix: a report under rounds/
    // parses as a receipt identity and pollutes finished()/all().
    const key = `reports/${roundId}/integrity-${dataset}.json`;
    await store.put(key, Buffer.from(JSON.stringify(report)), { contentType: "application/json" });
    console.log(`wrote ${key}`);
  } else {
    console.log("(DRY RUN — report not written)");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
