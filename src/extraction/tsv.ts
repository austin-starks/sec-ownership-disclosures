import JSZip from "jszip";

export type TsvRecord = Record<string, string>;

/** Rows of one TSV inside a quarterly SEC data set ZIP. Shared by the Form 3/4/5 and Form 13F readers. */
export async function readTsvArchive(
  archive: JSZip,
  name: string,
  datasetLabel: string,
  requiredColumns: readonly string[] = []
): Promise<TsvRecord[]> {
  const entry = archive.file(name);
  if (!entry) throw new Error(`${datasetLabel} is missing ${name}`);
  const [headerLine, ...lines] = (await entry.async("string")).replace(/^﻿/, "").split(/\r?\n/);
  const header = (headerLine ?? "").split("\t").map((column) => column.trim());
  for (const column of requiredColumns) {
    if (!header.includes(column)) throw new Error(`${name} is missing the ${column} column`);
  }
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line.split("\t");
      const record: TsvRecord = {};
      header.forEach((column, index) => {
        record[column] = cells[index] ?? "";
      });
      return record;
    });
}
