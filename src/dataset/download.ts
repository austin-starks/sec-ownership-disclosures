/**
 * Download the published SEC ownership dataset from Hugging Face.
 *
 * The dataset root holds `snapshot.json`: every table, every year, every file
 * with its size and sha256. The download is driven by that manifest rather than
 * by listing the repository, so a partial or tampered mirror cannot pass — each
 * file is verified against its digest before it is moved into place, and a file
 * already present with the right digest is reused.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, statfs, unlink, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";

export const PUBLIC_SEC_OWNERSHIP_DATASET = "austin-starks/sec-ownership-disclosures";
const DEFAULT_REVISION = "main";

/** Tables the snapshot may carry. A snapshot naming anything else is rejected. */
export const SEC_OWNERSHIP_DATASET_TABLES = [
  "insider_filings",
  "insider_transactions",
  "institutional_filings",
  "institutional_holdings",
] as const;

export type SecOwnershipTable = (typeof SEC_OWNERSHIP_DATASET_TABLES)[number];

export interface DatasetFile {
  publicPath: string;
  size: number;
  sha256: string;
}

export interface DatasetTable {
  rows: number;
  years: number[];
  manifests: Array<{ year: number; files: DatasetFile[] }>;
}

export interface SecOwnershipDatasetSnapshot {
  schemaVersion: number;
  dataset: string;
  generatedAt: string;
  totals: Record<string, number>;
  tables: Partial<Record<SecOwnershipTable, DatasetTable>>;
}

export interface DatasetDownloadPlan {
  destination: string;
  files: number;
  requiredBytes: number;
  availableBytes: number;
  enoughSpace: boolean;
}

export interface DatasetDownloadResult {
  dataset: string;
  destination: string;
  generatedAt: string;
  downloadedFiles: number;
  reusedFiles: number;
  bytes: number;
  snapshot: SecOwnershipDatasetSnapshot;
}

interface DownloadResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DownloadSecOwnershipDatasetOptions {
  destination: string;
  /** One table, or every table in the snapshot. */
  table?: SecOwnershipTable | undefined;
  /** One year, or every year the table publishes. */
  year?: number | undefined;
  revision?: string | undefined;
  fetcher?: (url: string) => Promise<DownloadResponse>;
  onSnapshot?: (snapshot: SecOwnershipDatasetSnapshot) => void | Promise<void>;
  onPlan?: (plan: DatasetDownloadPlan) => void;
  onProgress?: (message: string) => void;
}

function datasetUrl(dataset: string, revision: string, path: string): string {
  const datasetParts = dataset.split("/").map(encodeURIComponent).join("/");
  const pathParts = path.split("/").map(encodeURIComponent).join("/");
  return `https://huggingface.co/datasets/${datasetParts}/resolve/${encodeURIComponent(revision)}/${pathParts}`;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

/**
 * A path from the manifest is used to write a local file, so it is checked
 * rather than trusted: inside `data/`, normalized, no absolute prefix and no
 * backslash. Otherwise a crafted snapshot could write outside the destination.
 */
function safePublicPath(value: unknown, label: string): string {
  const path = string(value, label);
  const normalized = posix.normalize(path);
  if (path !== normalized || path.startsWith("/") || !path.startsWith("data/") || path.includes("\\")) {
    throw new Error(`${label} is not a safe dataset path`);
  }
  return path;
}

export function parseSecOwnershipDatasetSnapshot(value: unknown): SecOwnershipDatasetSnapshot {
  const root = object(value, "snapshot");
  const rawTables = object(root.tables, "snapshot.tables");
  const tables: Partial<Record<SecOwnershipTable, DatasetTable>> = {};
  for (const [tableName, rawTable] of Object.entries(rawTables)) {
    if (!(SEC_OWNERSHIP_DATASET_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(`snapshot.tables names an unknown table: ${tableName}`);
    }
    const table = object(rawTable, `snapshot.tables.${tableName}`);
    if (!Array.isArray(table.years) || !Array.isArray(table.manifests)) {
      throw new Error(`snapshot.tables.${tableName} is missing years or manifests`);
    }
    const years = table.years.map((year, index) => nonNegativeInteger(year, `${tableName}.years[${index}]`));
    const manifests = table.manifests.map((rawManifest, manifestIndex) => {
      const manifest = object(rawManifest, `${tableName}.manifests[${manifestIndex}]`);
      const year = nonNegativeInteger(manifest.year, `${tableName}.manifests[${manifestIndex}].year`);
      if (!Array.isArray(manifest.files)) {
        throw new Error(`${tableName}.manifests[${manifestIndex}].files must be an array`);
      }
      const files = manifest.files.map((rawFile, fileIndex) => {
        const file = object(rawFile, `${tableName}.${year}.files[${fileIndex}]`);
        const sha256 = string(file.sha256, `${tableName}.${year}.files[${fileIndex}].sha256`);
        if (!/^[a-f0-9]{64}$/.test(sha256)) {
          throw new Error(`${tableName}.${year}.files[${fileIndex}].sha256 is invalid`);
        }
        return {
          publicPath: safePublicPath(file.publicPath, `${tableName}.${year}.files[${fileIndex}].publicPath`),
          size: nonNegativeInteger(file.size, `${tableName}.${year}.files[${fileIndex}].size`),
          sha256,
        };
      });
      return { year, files };
    });
    tables[tableName as SecOwnershipTable] = {
      rows: nonNegativeInteger(table.rows, `snapshot.tables.${tableName}.rows`),
      years,
      manifests,
    };
  }
  const rawTotals = object(root.totals, "snapshot.totals");
  const totals: Record<string, number> = {};
  for (const [key, count] of Object.entries(rawTotals)) {
    totals[key] = nonNegativeInteger(count, `snapshot.totals.${key}`);
  }
  return {
    schemaVersion: nonNegativeInteger(root.schemaVersion, "snapshot.schemaVersion"),
    dataset: string(root.dataset, "snapshot.dataset"),
    generatedAt: string(root.generatedAt, "snapshot.generatedAt"),
    totals,
    tables,
  };
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function availableBytes(path: string): Promise<number> {
  try {
    const stats = await statfs(path);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Fetch the snapshot, then every file it lists (optionally one table or one
 * year). Returns what was downloaded, what was reused, and the snapshot — the
 * caller needs it to build SQLite without re-reading the network.
 */
export async function downloadSecOwnershipDataset(
  options: DownloadSecOwnershipDatasetOptions
): Promise<DatasetDownloadResult> {
  const {
    destination,
    table,
    year,
    revision = DEFAULT_REVISION,
    fetcher = (url: string) => fetch(url) as unknown as Promise<DownloadResponse>,
    onSnapshot,
    onPlan,
    onProgress,
  } = options;
  const dataset = PUBLIC_SEC_OWNERSHIP_DATASET;
  const root = resolve(destination);

  const snapshotResponse = await fetcher(datasetUrl(dataset, revision, "snapshot.json"));
  if (!snapshotResponse.ok) {
    throw new Error(
      `snapshot.json: HTTP ${snapshotResponse.status} ${snapshotResponse.statusText}. ` +
        `The dataset may not be published yet — build your own lake with sec-backfill instead.`
    );
  }
  const snapshot = parseSecOwnershipDatasetSnapshot(JSON.parse(await snapshotResponse.text()));
  await onSnapshot?.(snapshot);

  const wanted: DatasetFile[] = [];
  for (const [name, entry] of Object.entries(snapshot.tables)) {
    if (table && name !== table) continue;
    for (const manifest of entry!.manifests) {
      if (year !== undefined && manifest.year !== year) continue;
      wanted.push(...manifest.files);
    }
  }
  if (wanted.length === 0) {
    throw new Error(
      `the snapshot has no files for ${table ?? "any table"}${year === undefined ? "" : ` in ${year}`}`
    );
  }

  const requiredBytes = wanted.reduce((sum, file) => sum + file.size, 0);
  await mkdir(root, { recursive: true });
  const free = await availableBytes(root);
  const plan: DatasetDownloadPlan = {
    destination: root,
    files: wanted.length,
    requiredBytes,
    availableBytes: free,
    enoughSpace: free >= requiredBytes,
  };
  onPlan?.(plan);
  if (!plan.enoughSpace) {
    throw new Error(
      `${(requiredBytes / 1e9).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free at ${root}. ` +
        `Pass --table or --year to fetch part of it.`
    );
  }

  let downloadedFiles = 0;
  let reusedFiles = 0;
  let bytes = 0;
  for (const file of wanted) {
    const target = resolve(root, file.publicPath);
    if (!target.startsWith(root)) throw new Error(`${file.publicPath} resolves outside ${root}`);
    await mkdir(dirname(target), { recursive: true });

    try {
      if ((await sha256OfFile(target)) === file.sha256) {
        reusedFiles += 1;
        bytes += file.size;
        onProgress?.(`reused ${file.publicPath}`);
        continue;
      }
    } catch {
      // Absent or unreadable: download it below.
    }

    const response = await fetcher(datasetUrl(dataset, revision, file.publicPath));
    if (!response.ok) {
      throw new Error(`${file.publicPath}: HTTP ${response.status} ${response.statusText}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(body).digest("hex");
    if (digest !== file.sha256) {
      throw new Error(`${file.publicPath}: sha256 ${digest} does not match the snapshot's ${file.sha256}`);
    }
    // Write beside the target, then rename: an interrupted download never
    // leaves a truncated file that the next run would reuse as valid.
    const temporary = `${target}.partial`;
    await writeFile(temporary, body);
    await rename(temporary, target);
    downloadedFiles += 1;
    bytes += body.byteLength;
    onProgress?.(`downloaded ${file.publicPath} (${(body.byteLength / 1e6).toFixed(1)} MB)`);
  }

  await writeFile(resolve(root, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  return {
    dataset,
    destination: root,
    generatedAt: snapshot.generatedAt,
    downloadedFiles,
    reusedFiles,
    bytes,
    snapshot,
  };
}

/** Remove a partial file left by an interrupted run. */
export async function removePartial(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
