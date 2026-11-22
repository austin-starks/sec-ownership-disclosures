/**
 * Turn the downloaded Parquet files into one queryable SQLite database.
 *
 * SQLite comes from `node:sqlite` (Node 22.5+) and Parquet from `hyparquet`, so
 * nothing here needs a native build step: `npx` works on a laptop with no
 * toolchain. Each column gets the SQLite type of its lake type: booleans are
 * INTEGER 0/1, doubles REAL, and identifiers, dates and timestamps TEXT, so
 * `WHERE isOfficer = 1` and `WHERE shares > 1000` compare as numbers and CIKs
 * and CUSIPs keep their leading zeros. Dates are `YYYY-MM-DD` and timestamps
 * full ISO strings, so `WHERE filingDate = '2024-03-15'` and
 * `WHERE availableAt <= '2024-01-01'` do what they look like they do. A column
 * the package does not declare has no type, so each value keeps the type it
 * was bound with.
 */
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { THIRTEEN_F_FILINGS_COLUMNS, THIRTEEN_F_HOLDINGS_COLUMNS } from "../lake/holdingsTables";
import { INSIDER_FILINGS_COLUMNS, INSIDER_TRANSACTIONS_COLUMNS } from "../lake/insiderLakeTables";
import { insiderFilingCeoColumnsFromShard } from "../lake/insiderShardRows";
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
 * The columns each table is created with. Anything else in the Parquet files is
 * still inserted: a key first seen in a later file is added with
 * `ALTER TABLE ADD COLUMN`. These are declared so an empty year still produces
 * a table a query can run against.
 */
const DECLARED_COLUMNS: Record<SecOwnershipTable, readonly string[]> = {
  insider_filings: [
    "accession", "formType", "filingDate", "availableAt", "periodOfReport",
    "issuerCik", "issuerName", "issuerTicker", "resolvedTicker", "ownerCik", "ownerName",
    "isDirector", "isOfficer", "isTenPercentOwner", "officerTitle", "isCeo", "ceoTitleRule",
  ],
  insider_transactions: [
    "accession", "rowKind", "rowSk", "formType", "issuerCik", "issuerTicker", "resolvedTicker",
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

enum SqliteColumnType {
  Integer = "INTEGER",
  Real = "REAL",
  Text = "TEXT",
}

/** The lake's declared column types, from the same maps the Parquet writer uses. */
const LAKE_COLUMN_TYPES: Record<SecOwnershipTable, Readonly<Record<string, string>>> = {
  insider_filings: INSIDER_FILINGS_COLUMNS,
  insider_transactions: INSIDER_TRANSACTIONS_COLUMNS,
  institutional_filings: THIRTEEN_F_FILINGS_COLUMNS,
  institutional_holdings: THIRTEEN_F_HOLDINGS_COLUMNS,
};

const SQLITE_TYPE_OF_LAKE_TYPE: Readonly<Record<string, SqliteColumnType>> = {
  BOOLEAN: SqliteColumnType.Integer,
  BIGINT: SqliteColumnType.Integer,
  INTEGER: SqliteColumnType.Integer,
  DOUBLE: SqliteColumnType.Real,
  VARCHAR: SqliteColumnType.Text,
  DATE: SqliteColumnType.Text,
  TIMESTAMP: SqliteColumnType.Text,
};

/** The lake type of a column the package declares, or undefined for any other column. */
function lakeTypeOf(table: SecOwnershipTable, column: string): string | undefined {
  const declared = LAKE_COLUMN_TYPES[table];
  return Object.hasOwn(declared, column) ? declared[column] : undefined;
}

/**
 * A declared column takes the SQLite type of its lake type. Any other column is
 * declared with no type, so a column whose first file holds only nulls still
 * stores later numbers as numbers.
 */
function columnDefinition(table: SecOwnershipTable, column: string): string {
  const lakeType = lakeTypeOf(table, column);
  if (lakeType === undefined) return quote(column);
  const sqliteType = SQLITE_TYPE_OF_LAKE_TYPE[lakeType];
  if (!sqliteType) throw new Error(`no SQLite type for ${table}.${column} (${lakeType})`);
  return `${quote(column)} ${sqliteType}`;
}

/**
 * The row as stored. An `insider_filings` row from a year published before
 * `isCeo` existed, or under an earlier rule, gets the current rule's CEO
 * columns, the same decision the shard reader makes.
 */
function storedRow(table: SecOwnershipTable, row: Record<string, unknown>): Record<string, unknown> {
  return table === "insider_filings" ? { ...row, ...insiderFilingCeoColumnsFromShard(row) } : row;
}

function quote(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`unsafe column name in the dataset: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * SQLite takes null, number, bigint, string and Buffer. node:sqlite binds every
 * JS number as REAL, which a TEXT column stores as "1.0", so booleans and whole
 * numbers bind as bigint and are stored as integers. hyparquet reads DATE and
 * TIMESTAMP as JS Dates: a DATE is written as `YYYY-MM-DD`, a TIMESTAMP as the
 * full ISO string. Everything else is stringified.
 */
function bindable(value: unknown, lakeType: string | undefined): null | number | bigint | string | Uint8Array {
  if (value === null || value === undefined) return null;
  if (lakeType === "DATE" && value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof value === "bigint" || typeof value === "string") return value;
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

      let columns: string[] = [];
      let lakeTypes: Array<string | undefined> = [];
      let insert: ReturnType<typeof db.prepare> | null = null;
      let rows = 0;

      for (const file of files) {
        const parquetRows = await readParquet(resolve(datasetDirectory, file.publicPath));
        const first = parquetRows[0];
        if (!first) continue;

        // Every row of one Parquet file has the same keys; a later year may add one.
        const added = Object.keys(first).filter((key) => !columns.includes(key));
        if (!insert) {
          columns = [...new Set([...DECLARED_COLUMNS[table], ...added])];
          db.exec(`CREATE TABLE IF NOT EXISTS ${quote(table)} (${columns.map((c) => columnDefinition(table, c)).join(", ")})`);
        } else {
          for (const column of added) db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${columnDefinition(table, column)}`);
          columns.push(...added);
        }
        if (!insert || added.length > 0) {
          lakeTypes = columns.map((column) => lakeTypeOf(table, column));
          insert = db.prepare(
            `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) ` +
              `VALUES (${columns.map(() => "?").join(", ")})`
          );
        }

        db.exec("BEGIN");
        for (const row of parquetRows) {
          const stored = storedRow(table, row);
          insert.run(...columns.map((column, index) => bindable(stored[column], lakeTypes[index])));
        }
        db.exec("COMMIT");
        rows += parquetRows.length;
        options.onProgress?.(`${table}: ${rows.toLocaleString("en-US")} rows`);
      }

      if (insert) {
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
