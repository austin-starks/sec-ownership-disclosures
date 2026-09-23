#!/usr/bin/env node
/**
 * Quarterly SEC backfill: download each quarter/window, archive the raw ZIP
 * content-addressed, parse it, and write a receipt. Resumable and shardable:
 * a restarted machine skips receipted quarters, and N machines split by
 * `--shard index/count` on stable identity hashes.
 *
 * DRY RUN by default: lists the shard's pending quarters and receipt counts,
 * writes nothing. Pass `--run` to execute.
 *
 * Usage:
 *   node dist/cli/secBackfill.js --dataset form345 --from 2006q1 --to 2026q2 --run
 *   node dist/cli/secBackfill.js --dataset form13f --discover --shard 0/4 --run
 */
import { createHash } from "crypto";

import { FileDataStore } from "../backfill/adapters/filesystem";
import { S3DataStore } from "../backfill/adapters/s3-data-store";
import { createReceiptStore, type ReceiptStore } from "../backfill/receipts";
import { parseShard, type Shard } from "../backfill/shard";
import { pendingForShard } from "../backfill/receipts";
import { readProgress } from "../backfill/progress";
import { runRound } from "../backfill/round";
import type { DataStore } from "../backfill/ports";
import { fetchForm345DatasetZip } from "../sources/form345Datasets";
import { parseForm345Dataset } from "../extraction/form345Dataset";
import { fetchThirteenFDatasetZip, thirteenFQuarterUrls, thirteenFWindowUrls } from "../sources/thirteenFDatasets";
import { parseThirteenFDataset } from "../extraction/infoTable";
import { discoverThirteenFWindows, form345QuarterIdentities, thirteenFQuarterIdentities, type QuarterIdentity } from "../backfill/quarters";
import { nodeFetchHttp } from "../runtime/nodeHttp";
import type { SecHttp } from "../sources/http";

const FORM_13F_INDEX_URL = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets";

interface CliOptions {
  dataset: "form345" | "form13f";
  from: string | null;
  to: string | null;
  discover: boolean;
  shard: Shard;
  batchSize: number;
  maxItems: number | null;
  maxPasses: number;
  run: boolean;
  store: "tigris" | "fs";
  fsRoot: string;
  tigrisBucket: string;
  tigrisEndpoint: string;
  tigrisPrefix: string;
  roundId: string;
  userAgent: string;
}

function argValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? (argv[index + 1] as string) : null;
}

function parseYearQuarter(value: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const match = /^(\d{4})q([1-4])$/.exec(value);
  if (!match || !match[1] || !match[2]) throw new Error(`quarter must look like 2006q1, got "${value}"`);
  return { year: Number(match[1]), quarter: Number(match[2]) as 1 | 2 | 3 | 4 };
}

function parseOptions(argv: string[]): CliOptions {
  const dataset = argValue(argv, "--dataset");
  if (dataset !== "form345" && dataset !== "form13f") throw new Error("--dataset must be form345 or form13f");
  const store = argValue(argv, "--store") ?? "tigris";
  if (store !== "tigris" && store !== "fs") throw new Error("--store must be tigris or fs");
  return {
    dataset,
    from: argValue(argv, "--from"),
    to: argValue(argv, "--to"),
    discover: argv.includes("--discover"),
    shard: parseShard(argValue(argv, "--shard") ?? "0/1"),
    batchSize: Number(argValue(argv, "--batch-size") ?? "1"),
    maxItems: argValue(argv, "--max-items") ? Number(argValue(argv, "--max-items") as string) : null,
    maxPasses: Number(argValue(argv, "--max-passes") ?? "100"),
    run: argv.includes("--run"),
    store,
    fsRoot: argValue(argv, "--fs-root") ?? "/tmp/sec-backfill",
    tigrisBucket: argValue(argv, "--tigris-bucket") ?? "nexustrade-parquet",
    tigrisEndpoint: argValue(argv, "--tigris-endpoint") ?? "https://fly.storage.tigris.dev",
    tigrisPrefix: argValue(argv, "--tigris-prefix") ?? "sec-ownership",
    roundId: argValue(argv, "--round") ?? `backfill-${new Date().toISOString().slice(0, 10)}`,
    userAgent: argValue(argv, "--user-agent") ?? "NexusTrade (austin@nexustrade.io)",
  };
}

interface WorkItem extends QuarterIdentity {
  urls: string[];
}

async function listWork(http: SecHttp, options: CliOptions): Promise<WorkItem[]> {
  if (options.dataset === "form345") {
    if (!options.from || !options.to) throw new Error("form345 needs --from YYYqN and --to YYYqN");
    return form345QuarterIdentities(parseYearQuarter(options.from), parseYearQuarter(options.to)).map((q) => ({
      ...q,
      urls: [`https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${q.label}_form345.zip`],
    }));
  }
  if (options.discover) {
    const html = (await http.get(FORM_13F_INDEX_URL)).toString("utf8");
    return discoverThirteenFWindows(html).map((stem) => ({
      dataset: "form13f" as const,
      label: stem,
      identity: `form13f:${stem}`,
      urls: thirteenFWindowUrls(stem),
    }));
  }
  if (!options.from || !options.to) throw new Error("form13f needs --discover or --from/--to classic quarters");
  return thirteenFQuarterIdentities(parseYearQuarter(options.from), parseYearQuarter(options.to)).flatMap((q) => {
    const year = Number(q.label.slice(0, 4));
    const quarter = Number(q.label.slice(5, 6)) as 1 | 2 | 3 | 4;
    return [{ ...q, urls: thirteenFQuarterUrls(year, quarter) }];
  });
}

function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const http = nodeFetchHttp({ userAgent: options.userAgent });
  const store: DataStore =
    options.store === "fs"
      ? new FileDataStore(options.fsRoot)
      : new S3DataStore({
          bucket: options.tigrisBucket,
          endpoint: options.tigrisEndpoint,
          region: "auto",
          keyPrefix: options.tigrisPrefix,
        });
  const receipts: ReceiptStore = createReceiptStore({ store, root: "rounds", roundId: options.roundId });

  const items = await listWork(http, options);
  const finished = await receipts.finished();
  let pending = pendingForShard(items, (item) => item.identity, options.shard, finished);
  if (options.maxItems !== null) pending = pending.slice(0, options.maxItems);
  const progress = await readProgress(receipts);

  console.log(
    `${options.dataset} round ${options.roundId} shard ${options.shard.index}/${options.shard.count}: ` +
      `${items.length} listed, ${finished.size} receipted, ${pending.length} pending${options.run ? "" : " (DRY RUN)"}`
  );
  if (!options.run) {
    for (const item of pending.slice(0, 20)) console.log(`  pending ${item.identity}`);
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    console.log(`store receipts: ${progress.total}`);
    return;
  }

  const rawPrefix = options.dataset === "form345" ? "raw/sec345/datasets" : "raw/sec13f/datasets";
  const summary = await runRound({
    shard: options.shard,
    receipts,
    list: async () => (options.maxItems !== null ? items.slice(0, options.maxItems) : items),
    identityOf: (item: WorkItem) => item.identity,
    process: async (batch) => {
      const out: Array<{ identity: string; body: Buffer }> = [];
      for (const item of batch) {
        const zip =
          options.dataset === "form345"
            ? await fetchForm345DatasetZip(http, Number(item.label.slice(0, 4)), Number(item.label.slice(5, 6)) as 1 | 2 | 3 | 4)
            : await fetchThirteenFDatasetZip(http, item.urls);
        if (!zip) throw new Error(`${item.identity} not published yet; deferred to a later pass`);
        const rawKey = `${rawPrefix}/${item.label}/${sha256Hex(zip)}.zip`;
        await store.putIfAbsent(rawKey, zip, { contentType: "application/zip" });
        const counts =
          options.dataset === "form345"
            ? await (async () => {
                const rows = await parseForm345Dataset(zip, rawKey);
                return { filings: rows.filings.length, rows: rows.transactions.length };
              })()
            : await (async () => {
                const rows = await parseThirteenFDataset(zip, rawKey);
                return { filings: rows.filings.length, rows: rows.holdings.length };
              })();
        out.push({
          identity: item.identity,
          body: Buffer.from(JSON.stringify({ ...counts, bytes: zip.length, rawKey })),
        });
        console.log(`  done ${item.identity}: ${JSON.stringify(counts)}`);
      }
      return out;
    },
    batchSize: options.batchSize,
    maxPasses: options.maxPasses,
    onPass: (pass) =>
      console.log(
        `pass ${pass.pass}: processed=${pass.processed} deferred=${pass.deferred}` +
          (pass.failures.length ? ` failures=${JSON.stringify(pass.failures.slice(0, 3))}` : "")
      ),
  });
  console.log(`round complete=${summary.complete} passes=${summary.passes.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
