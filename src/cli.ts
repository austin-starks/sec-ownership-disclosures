#!/usr/bin/env node
/**
 * The package's front door.
 *
 *   npx sec-ownership-disclosures download --sqlite
 *
 * Two ways in, and they answer different questions. `download` fetches the
 * published dataset and, with `--sqlite`, leaves a database you can query in
 * one command — no SEC credentials, no twenty-year backfill, no model or OCR
 * keys. `backfill`, `integrity` and `lags` build and audit your own lake from
 * the official sources; they live in their own executables because they take
 * many more flags.
 */
import { resolve } from "node:path";

import {
  PUBLIC_SEC_OWNERSHIP_DATASET,
  SEC_OWNERSHIP_DATASET_TABLES,
  downloadSecOwnershipDataset,
  type SecOwnershipTable,
} from "./dataset/download";
import { materializeSecOwnershipSqlite } from "./dataset/sqlite";

const USAGE = `sec-ownership-disclosures

  download [options]   Download the published dataset (${PUBLIC_SEC_OWNERSHIP_DATASET})

    --out <dir>        Where to put it (default ./sec-ownership-data)
    --table <name>     One of: ${SEC_OWNERSHIP_DATASET_TABLES.join(", ")}
    --year <YYYY>      One year only
    --sqlite [path]    Also build a SQLite database (default <out>/sec-ownership.db)
    --revision <ref>   Dataset revision (default main)

  Build your own lake from official SEC sources instead:

    npx sec-backfill --dataset form345 --from 2006q1 --to 2026q1 --run
    npx sec-integrity --dataset form345 --round <round>
    npx sec-lags --round <round>
`;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : "";
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function download(): Promise<void> {
  const destination = resolve(flag("out") || "./sec-ownership-data");
  const table = flag("table") as SecOwnershipTable | undefined;
  if (table && !(SEC_OWNERSHIP_DATASET_TABLES as readonly string[]).includes(table)) {
    throw new Error(`--table must be one of: ${SEC_OWNERSHIP_DATASET_TABLES.join(", ")}`);
  }
  const yearText = flag("year");
  const year = yearText ? Number(yearText) : undefined;
  if (yearText && !Number.isInteger(year)) throw new Error("--year must be a four-digit year");

  const result = await downloadSecOwnershipDataset({
    destination,
    table,
    year,
    revision: flag("revision") || undefined,
    onSnapshot: (snapshot) => {
      const tables = Object.entries(snapshot.tables)
        .map(([name, entry]) => `${name} ${entry!.rows.toLocaleString("en-US")} rows`)
        .join(" · ");
      console.log(`${snapshot.dataset} generated ${snapshot.generatedAt}`);
      console.log(`  ${tables}`);
    },
    onPlan: (plan) => {
      console.log(
        `  ${plan.files} files, ${(plan.requiredBytes / 1e9).toFixed(2)} GB into ${plan.destination}`
      );
    },
    onProgress: (message) => console.log(`  ${message}`),
  });

  console.log(
    `\nDownloaded ${result.downloadedFiles}, reused ${result.reusedFiles} ` +
      `(${(result.bytes / 1e9).toFixed(2)} GB) in ${result.destination}`
  );

  if (!has("sqlite")) {
    console.log("\nPass --sqlite to build a queryable database from these files.");
    return;
  }

  const databasePath = resolve(flag("sqlite") || `${result.destination}/sec-ownership.db`);
  console.log(`\nBuilding ${databasePath} ...`);
  const built = await materializeSecOwnershipSqlite({
    datasetDirectory: result.destination,
    databasePath,
    snapshot: result.snapshot,
    // The same narrowing the download just used, so the build reads the files
    // that were actually fetched rather than every file in the snapshot.
    selection: { table, year },
    onProgress: (message) => process.stdout.write(`\r  ${message.padEnd(60)}`),
  });
  const rows = built.tables.map((entry) => `${entry.table} ${entry.rows.toLocaleString("en-US")}`).join(" · ");
  console.log(`\n\n${built.database} (${(built.bytes / 1e9).toFixed(2)} GB)\n  ${rows}`);
  console.log(`\nQuery it:\n  sqlite3 ${built.database} "SELECT transactionCode, count(*) FROM insider_transactions GROUP BY 1 ORDER BY 2 DESC LIMIT 5"`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (command === "download") return download();
  console.error(`unknown command: ${command}\n`);
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
