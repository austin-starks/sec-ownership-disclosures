/**
 * Turn the downloaded Parquet files into one queryable SQLite database.
 *
 * SQLite comes from `node:sqlite` (Node 22.5+) and Parquet from `hyparquet`, so
 * nothing here needs a native build step: `npx` works on a laptop with no
 * toolchain. Columns are written as the source declares them, with
 * `availableAt` kept as an ISO string so `WHERE availableAt <= '2024-01-01'`
 * does what it looks like it does.
 */
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { selectDatasetFiles } from "./download";
import type {
  DatasetFile,
  DatasetSelection,
  SecOwnershipDatasetSnapshot,
  SecOwnershipTable,
} from "./download";

export interface MaterializeSecOwnershipSqliteOptions {
  datasetDirectory: string;
  databasePath: string;
  snapshot: SecOwnershipDatasetSnapshot;
  /**
   * The same narrowing the download used. Omit it only when the whole dataset
   * is on disk — a build that walks the full snapshot after a filtered
   * download reads a file that was never fetched and dies partway through.
   */
  selection?: DatasetSelection;
  /** Overridable for tests, so the suite never needs a real Parquet file. */
  readParquetFile?: (path: string) => Promise<readonly Record<string, unknown>[]>;
  onProgress?: (message: string) => void;
}

export interface MaterializedSecOwnershipSqlite {
  database: string;
  tables: Array<{ table: SecOwnershipTable; rows: number }>;
  bytes: number;
}

/**
 * The columns each table is created with. Anything else in the Parquet file is
 * still inserted — the schema is `CREATE TABLE` plus the union of keys seen in
 * the first row group — but these are declared so an empty year still produces
 * a table a query can run against.
 */
const DECLARED_COLUMNS: Record<SecOwnershipTable, readonly string[]> = {
  insider_filings: [
    "accession", "formType", "filingDate", "availableAt", "periodOfReport",
    "issuerCik", "issuerName", "issuerTicker", "ownerCik", "ownerName",
    "isDirector", "isOfficer", "isTenPercentOwner", "officerTitle",
  ],
  insider_transactions: [
    "accession", "rowKind", "rowSk", "formType", "issuerCik", "issuerTicker",
    "availableAt", "securityTitle", "transactionDate", "transactionCode",
    "shares", "pricePerShare", "acquiredDisposed", "sharesOwnedFollowing",
  ],
  institutional_filings: [
    "accession", "filingDate", "availableAt", "submissionType", "cik",
    "managerName", "periodOfReport", "isAmendment",
  ],
  institutional_holdings: [
    "accession", "infoTableSk", "availableAt", "issuerName", "titleOfClass",
    "cusip", "figi", "value", "sharesAmount", "sharesType", "putCall",
  ],
};

function quote(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`unsafe column name in the dataset: ${identifier}`);
  }
  return `"${identifier}"`;
}

/** SQLite takes null, number, bigint, string and Buffer. Everything else is stringified. */
function bindable(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

async function defaultReadParquetFile(path: string): Promise<readonly Record<string, unknown>[]> {
  const [{ asyncBufferFromFile, parquetReadObjects }, { compressors }] = await Promise.all([
    import("hyparquet/src/node.js"),
    import("hyparquet-compressors"),
  ]);
  const file = await asyncBufferFromFile(path);
  return (await parquetReadObjects({ file, compressors })) as Record<string, unknown>[];
}

async function removeSqliteFiles(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-shm`, `${path}-wal`].map((candidate) =>
      unlink(candidate).catch((error: unknown) => {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") throw error;
      })
    )
  );
}

export async function materializeSecOwnershipSqlite(
  options: MaterializeSecOwnershipSqliteOptions
): Promise<MaterializedSecOwnershipSqlite> {
  const { DatabaseSync } = await import("node:sqlite");
  const datasetDirectory = resolve(options.datasetDirectory);
  const database = resolve(options.databasePath);
  const readParquet = options.readParquetFile ?? defaultReadParquetFile;

  await mkdir(dirname(database), { recursive: true });
  // Built beside the target and renamed at the end, so an interrupted run never
  // leaves a half-populated database that looks complete.
  const building = `${database}.building`;
  await removeSqliteFiles(building);

  const db = new DatabaseSync(building);
  const written: Array<{ table: SecOwnershipTable; rows: number }> = [];
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = OFF");

    const selected = selectDatasetFiles(options.snapshot, options.selection ?? {});
    const byTable = new Map<SecOwnershipTable, DatasetFile[]>();
    for (const entry of selected) {
      const bucket = byTable.get(entry.table) ?? [];
      bucket.push(entry.file);
      byTable.set(entry.table, bucket);
    }

    for (const [table, files] of byTable) {
      if (files.length === 0) continue;

      let columns: string[] | null = null;
      let insert: ReturnType<typeof db.prepare> | null = null;
      let rows = 0;

      for (const file of files) {
        const parquetRows = await readParquet(resolve(datasetDirectory, file.publicPath));
        if (parquetRows.length === 0) continue;

        if (!columns) {
          const seen = new Set<string>(DECLARED_COLUMNS[table]);
          for (const key of Object.keys(parquetRows[0]!)) seen.add(key);
          columns = [...seen];
          db.exec(
            `CREATE TABLE IF NOT EXISTS ${quote(table)} (${columns.map((c) => `${quote(c)} TEXT`).join(", ")})`
          );
          insert = db.prepare(
            `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) ` +
              `VALUES (${columns.map(() => "?").join(", ")})`
          );
        }

        db.exec("BEGIN");
        for (const row of parquetRows) {
          insert!.run(...columns!.map((column) => bindable(row[column])));
        }
        db.exec("COMMIT");
        rows += parquetRows.length;
        options.onProgress?.(`${table}: ${rows.toLocaleString("en-US")} rows`);
      }

      if (columns) {
        // The indexes every question starts from: who filed, about which issuer,
        // and what was knowable by a date.
        if (columns.includes("availableAt")) {
          db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`${table}_available_at`)} ON ${quote(table)} ("availableAt")`);
        }
        if (columns.includes("issuerCik")) {
          db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`${table}_issuer_cik`)} ON ${quote(table)} ("issuerCik")`);
        }
        if (columns.includes("accession")) {
          db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`${table}_accession`)} ON ${quote(table)} ("accession")`);
        }
        if (columns.includes("cusip")) {
          db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`${table}_cusip`)} ON ${quote(table)} ("cusip")`);
        }
        written.push({ table, rows });
      }
    }

    db.exec(
      "CREATE TABLE IF NOT EXISTS dataset_snapshot (dataset TEXT NOT NULL, generated_at TEXT NOT NULL, schema_version INTEGER NOT NULL)"
    );
    db.prepare("INSERT INTO dataset_snapshot (dataset, generated_at, schema_version) VALUES (?, ?, ?)").run(
      options.snapshot.dataset,
      options.snapshot.generatedAt,
      options.snapshot.schemaVersion
    );
  } finally {
    db.close();
  }

  await removeSqliteFiles(database);
  await rename(building, database);
  return { database, tables: written, bytes: (await stat(database)).size };
}
