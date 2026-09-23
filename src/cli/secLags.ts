#!/usr/bin/env node
/**
 * Filing-lag distribution from SUBMISSION.tsv files only (lightweight: no
 * INFOTABLE parse): days between period-of-report and filing date, split by
 * original vs amendment. Answers whether the 45-day rule holds and how late
 * amendments run. DRY RUN by default; `--run` writes the JSON report.
 */
import { FileDataStore } from "../backfill/adapters/filesystem";
import { S3DataStore } from "../backfill/adapters/s3-data-store";
import type { DataStore } from "../backfill/ports";
import { readTsvArchive } from "../extraction/tsv";
import { parseSecDatasetDate } from "../utils/disclosureDates";

function argValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? (argv[index + 1] as string) : null;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const storeName = argValue(argv, "--store") ?? "tigris";
  const run = argv.includes("--run");
  const roundId = argValue(argv, "--round") ?? "";
  const store: DataStore =
    storeName === "fs"
      ? new FileDataStore(argValue(argv, "--fs-root") ?? "/tmp/sec-backfill")
      : new S3DataStore({
          bucket: argValue(argv, "--tigris-bucket") ?? "nexustrade-parquet",
          endpoint: argValue(argv, "--tigris-endpoint") ?? "https://fly.storage.tigris.dev",
          region: "auto",
          keyPrefix: argValue(argv, "--tigris-prefix") ?? "sec-ownership",
        });

  const rawPrefix = "raw/sec13f/datasets";
  const zips = (await store.list(rawPrefix)).filter((o) => o.key.endsWith(".zip"));
  const originalLags: number[] = [];
  const amendmentLags: number[] = [];
  let filings = 0;
  for (const object of zips) {
    const { default: JSZip } = await import("jszip");
    const archive = await JSZip.loadAsync(await store.get(object.key));
    const names = Object.keys(archive.files);
    const submissionName = names.includes("SUBMISSION.tsv")
      ? "SUBMISSION.tsv"
      : names.find((n) => n.endsWith("/SUBMISSION.tsv"));
    if (!submissionName) throw new Error(`no SUBMISSION.tsv in ${object.key}`);
    const rows = await readTsvArchive(archive, submissionName, "Form 13F data set", [
      "ACCESSION_NUMBER",
      "FILING_DATE",
      "SUBMISSIONTYPE",
      "PERIODOFREPORT",
    ]);
    for (const row of rows) {
      // DD-MMM-YYYY via the package's own verified parser — never Date.parse
      // on non-ISO strings (implementation-defined).
      const filedIso = parseSecDatasetDate(row["FILING_DATE"]);
      const periodIso = parseSecDatasetDate(row["PERIODOFREPORT"]);
      if (!filedIso || !periodIso) continue;
      filings += 1;
      const lag = Math.round(
        (new Date(`${filedIso}T00:00:00Z`).getTime() - new Date(`${periodIso}T00:00:00Z`).getTime()) / 86400000
      );
      if (!Number.isFinite(lag)) continue;
      if ((row["SUBMISSIONTYPE"] ?? "").endsWith("/A")) amendmentLags.push(lag);
      else originalLags.push(lag);
    }
  }
  originalLags.sort((a, b) => a - b);
  amendmentLags.sort((a, b) => a - b);
  const report = {
    windows: zips.length,
    filings,
    original: {
      n: originalLags.length,
      p50: quantile(originalLags, 0.5),
      p95: quantile(originalLags, 0.95),
      max: quantile(originalLags, 1),
    },
    amendment: {
      n: amendmentLags.length,
      p50: quantile(amendmentLags, 0.5),
      p95: quantile(amendmentLags, 0.95),
      max: quantile(amendmentLags, 1),
    },
  };
  console.log(JSON.stringify(report, null, 1));
  if (run) {
    if (!roundId) throw new Error("--round is required with --run");
    const key = `reports/${roundId}/filing-lags.json`;
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
