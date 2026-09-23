import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  downloadSecOwnershipDataset,
  parseSecOwnershipDatasetSnapshot,
  selectDatasetFiles,
} from "./download";
import { materializeSecOwnershipSqlite } from "./sqlite";

const TRANSACTIONS = [
  {
    accession: "0001",
    rowKind: "nonderiv",
    rowSk: "1",
    issuerCik: "320193",
    issuerTicker: "AAPL",
    availableAt: "2024-02-02T21:00:00.000Z",
    transactionCode: "P",
    shares: 1000,
  },
  {
    accession: "0002",
    rowKind: "nonderiv",
    rowSk: "1",
    issuerCik: "320193",
    issuerTicker: "AAPL",
    availableAt: "2024-03-04T21:00:00.000Z",
    transactionCode: "S",
    shares: 500,
  },
];

function snapshotFor(body: Buffer) {
  return {
    schemaVersion: 1,
    dataset: "austin-starks/sec-ownership-disclosures",
    generatedAt: "2026-09-23T00:00:00.000Z",
    totals: { insider_transactions: TRANSACTIONS.length },
    tables: {
      insider_transactions: {
        rows: TRANSACTIONS.length,
        years: [2024],
        manifests: [
          {
            year: 2024,
            files: [
              {
                publicPath: "data/insider_transactions/2024.parquet",
                size: body.byteLength,
                sha256: createHash("sha256").update(body).digest("hex"),
              },
            ],
          },
        ],
      },
    },
  };
}

function fetcherFor(snapshot: unknown, body: Buffer) {
  return async (url: string) => {
    const payload = url.endsWith("snapshot.json") ? Buffer.from(JSON.stringify(snapshot)) : body;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => payload.toString("utf8"),
      arrayBuffer: async (): Promise<ArrayBuffer> =>
        payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer,
    };
  };
}

describe("downloadSecOwnershipDataset", () => {
  it("verifies each file against the snapshot digest and reuses a good one", async () => {
    const destination = await mkdtemp(join(tmpdir(), "sec-dataset-"));
    const body = Buffer.from("parquet-bytes");
    const snapshot = snapshotFor(body);

    const first = await downloadSecOwnershipDataset({
      destination,
      fetcher: fetcherFor(snapshot, body),
    });
    expect(first.downloadedFiles).toBe(1);
    expect(first.reusedFiles).toBe(0);
    expect(await readFile(join(destination, "data/insider_transactions/2024.parquet"))).toEqual(body);

    // Second run over the same directory: nothing is fetched again.
    const second = await downloadSecOwnershipDataset({
      destination,
      fetcher: fetcherFor(snapshot, body),
    });
    expect(second.downloadedFiles).toBe(0);
    expect(second.reusedFiles).toBe(1);
  });

  it("refuses a file whose bytes do not match the digest", async () => {
    const destination = await mkdtemp(join(tmpdir(), "sec-dataset-"));
    const snapshot = snapshotFor(Buffer.from("the-bytes-the-snapshot-describes"));
    await expect(
      downloadSecOwnershipDataset({
        destination,
        fetcher: fetcherFor(snapshot, Buffer.from("something-else-entirely")),
      })
    ).rejects.toThrow(/does not match the snapshot/);
  });

  it("refuses a snapshot path that would escape the destination", () => {
    const escaping = {
      ...snapshotFor(Buffer.from("x")),
      tables: {
        insider_transactions: {
          rows: 1,
          years: [2024],
          manifests: [
            {
              year: 2024,
              files: [{ publicPath: "../../etc/passwd", size: 1, sha256: "a".repeat(64) }],
            },
          ],
        },
      },
    };
    expect(() => parseSecOwnershipDatasetSnapshot(escaping)).toThrow(/not a safe dataset path/);
  });

  it("refuses a table it does not know", () => {
    const rogue = { ...snapshotFor(Buffer.from("x")), tables: { arbitrary_table: { rows: 0, years: [], manifests: [] } } };
    expect(() => parseSecOwnershipDatasetSnapshot(rogue)).toThrow(/unknown table/);
  });
});

describe("materializeSecOwnershipSqlite", () => {
  it("builds a database that answers the question the dataset exists for", async () => {
    const datasetDirectory = await mkdtemp(join(tmpdir(), "sec-sqlite-"));
    await mkdir(join(datasetDirectory, "data/insider_transactions"), { recursive: true });
    await writeFile(join(datasetDirectory, "data/insider_transactions/2024.parquet"), "stub");

    const built = await materializeSecOwnershipSqlite({
      datasetDirectory,
      databasePath: join(datasetDirectory, "out.db"),
      snapshot: snapshotFor(Buffer.from("stub")) as never,
      readParquetFile: async () => TRANSACTIONS,
    });

    expect(built.tables).toEqual([{ table: "insider_transactions", rows: 2 }]);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(built.database);
    try {
      // The point-in-time filter: only the February purchase was knowable by then.
      const rows = db
        .prepare(
          "SELECT transactionCode, shares FROM insider_transactions WHERE availableAt <= ? ORDER BY availableAt"
        )
        .all("2024-02-29T00:00:00.000Z");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ transactionCode: "P" });

      const provenance = db.prepare("SELECT dataset, generated_at FROM dataset_snapshot").all();
      expect(provenance[0]).toMatchObject({ dataset: "austin-starks/sec-ownership-disclosures" });
    } finally {
      db.close();
    }
  });
});

describe("a filtered download and the database built from it", () => {
  /**
   * Two tables and two years, so a selection can be wrong in a way that shows.
   * Only `insider_transactions/2024` exists on disk — the shape a real
   * `--table insider_transactions --year 2024` download leaves behind.
   */
  const partialSnapshot = {
    schemaVersion: 1,
    dataset: "austin-starks/sec-ownership-disclosures",
    generatedAt: "2026-09-23T00:00:00.000Z",
    totals: { insider_transactions: 2, insider_filings: 1 },
    tables: {
      insider_filings: {
        rows: 1,
        years: [2006],
        manifests: [
          {
            year: 2006,
            files: [
              {
                publicPath: "data/insider_filings/2006.parquet",
                size: 1,
                sha256: "a".repeat(64),
              },
            ],
          },
        ],
      },
      insider_transactions: {
        rows: 2,
        years: [2023, 2024],
        manifests: [
          {
            year: 2023,
            files: [
              {
                publicPath: "data/insider_transactions/2023.parquet",
                size: 1,
                sha256: "b".repeat(64),
              },
            ],
          },
          {
            year: 2024,
            files: [
              {
                publicPath: "data/insider_transactions/2024.parquet",
                size: 1,
                sha256: "c".repeat(64),
              },
            ],
          },
        ],
      },
    },
  } as never;

  it("selects exactly the files a table-and-year narrowing covers", () => {
    const selected = selectDatasetFiles(partialSnapshot, {
      table: "insider_transactions",
      year: 2024,
    });
    expect(selected.map((entry) => entry.file.publicPath)).toEqual([
      "data/insider_transactions/2024.parquet",
    ]);
  });

  it("selects everything when nothing is narrowed", () => {
    expect(selectDatasetFiles(partialSnapshot)).toHaveLength(3);
  });

  it("builds the database from the files fetched, not the whole snapshot", async () => {
    // The regression: `download --table insider_transactions --year 2024
    // --sqlite` fetched one file, then the build walked every table in the
    // snapshot and died on `insider_filings/2006.parquet`, which it had never
    // asked for. Caught against the live dataset the first time a stranger's
    // command was run end to end.
    const datasetDirectory = await mkdtemp(join(tmpdir(), "sec-sqlite-partial-"));
    await mkdir(join(datasetDirectory, "data/insider_transactions"), { recursive: true });
    await writeFile(
      join(datasetDirectory, "data/insider_transactions/2024.parquet"),
      "stub",
    );

    const read: string[] = [];
    const built = await materializeSecOwnershipSqlite({
      datasetDirectory,
      databasePath: join(datasetDirectory, "out.db"),
      snapshot: partialSnapshot,
      selection: { table: "insider_transactions", year: 2024 },
      readParquetFile: async (path) => {
        read.push(path);
        return TRANSACTIONS;
      },
    });

    expect(read).toHaveLength(1);
    expect(read[0]).toContain("insider_transactions/2024.parquet");
    expect(built.tables).toEqual([{ table: "insider_transactions", rows: 2 }]);
  });

  it("still fails loudly when a selected file is absent", async () => {
    // A truncated download must not quietly produce a database that looks
    // complete; skipping what is missing would hide exactly that.
    const datasetDirectory = await mkdtemp(join(tmpdir(), "sec-sqlite-missing-"));

    await expect(
      materializeSecOwnershipSqlite({
        datasetDirectory,
        databasePath: join(datasetDirectory, "out.db"),
        snapshot: partialSnapshot,
        selection: { table: "insider_transactions", year: 2024 },
      }),
    ).rejects.toThrow();
  });
});
