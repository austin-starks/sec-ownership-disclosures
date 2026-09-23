import * as cheerio from "cheerio";
import { inflateRawSync } from "zlib";

import { requireRangeSupport, type SecHttp } from "./http";
import type { CalendarQuarter } from "./thirteenFDatasets";

/**
 * SEC's quarterly Form N-PORT structured data sets.
 *
 * These exist here for one reason: they are the only public bulk source that
 * pairs a CUSIP with a ticker. `institutional_holdings` (13F) is keyed by CUSIP
 * and carries no ticker, so 124M rows cannot join to prices, cannot be screened
 * and have never entered the Rust engine. N-PORT closes that, from a file,
 * with no API and no rate limit:
 *
 *   FUND_REPORTED_HOLDING.tsv   HOLDING_ID, ISSUER_CUSIP, ISSUER_NAME, ISSUER_LEI
 *            ⋈ HOLDING_ID
 *   IDENTIFIERS.tsv             HOLDING_ID, IDENTIFIER_TICKER, IDENTIFIER_ISIN
 *
 * **The ZIP is ~440 MB and we never download it.** Fly's root filesystem is
 * RAM-backed, and we need two of its 32 members. So this reads the ZIP central
 * directory out of the last 128 KB with a Range request, then Range-fetches only
 * the members it wants and inflates them. That is ~367 MB instead of 440 MB per
 * quarter, and more importantly it never holds a whole archive.
 *
 * Verified against 2026q2 on 2026-09-23: 32 members, IDENTIFIERS.tsv 84.7 MB
 * compressed / 254.6 MB raw, FUND_REPORTED_HOLDING.tsv 282.2 MB / 910.3 MB.
 *
 * Run this from a region SEC serves — SEC 403s some hosts. IAD works.
 */
const NPORT_LANDING_PAGE =
  "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets";
const NPORT_DATASET_BASE = "https://www.sec.gov/files/dera/data/form-n-port-data-sets";
/** The ZIP end-of-central-directory sits in the last bytes; 128 KB covers the directory too. */
const CENTRAL_DIRECTORY_TAIL_BYTES = 131_072;

export const NPORT_HOLDING_MEMBER = "FUND_REPORTED_HOLDING.tsv";
export const NPORT_IDENTIFIERS_MEMBER = "IDENTIFIERS.tsv";

export interface NportQuarter {
  year: number;
  quarter: CalendarQuarter;
  url: string;
}

export function nportDatasetUrl(year: number, quarter: CalendarQuarter): string {
  return `${NPORT_DATASET_BASE}/${year}q${quarter}_nport.zip`;
}

/**
 * The quarters SEC actually lists, parsed from the landing page rather than
 * guessed from a date range.
 *
 * The Form 345 sets taught this the expensive way: SEC moved that publication
 * to a second path and left the old one serving history, so probing a
 * constructed URL reported a live quarter as unpublished for two months. The
 * page is the authority on what exists.
 */
export async function listNportQuarters(http: SecHttp): Promise<NportQuarter[]> {
  const $ = cheerio.load((await http.get(NPORT_LANDING_PAGE)).toString("utf8"));
  const quarters = new Map<string, NportQuarter>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href || !href.endsWith("_nport.zip")) return;
    const file = href.slice(href.lastIndexOf("/") + 1);
    const year = Number(file.slice(0, 4));
    const quarter = Number(file.slice(5, 6));
    if (!Number.isInteger(year) || quarter < 1 || quarter > 4) return;
    const url = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
    quarters.set(file, { year, quarter: quarter as CalendarQuarter, url });
  });
  return [...quarters.values()].sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

interface ZipMemberEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
}

async function fetchRange(
  http: SecHttp,
  url: string,
  range: string,
): Promise<{ body: Buffer; total: number }> {
  const ranged = requireRangeSupport(http, "reading N-PORT data sets");
  const { body, totalBytes } = await ranged.getRange(url, range);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error(`${url} did not report a total size; refusing to read it as a whole`);
  }
  return { body, total: totalBytes };
}

async function fetchBytes(http: SecHttp, url: string, start: number, end: number): Promise<Buffer> {
  return (await fetchRange(http, url, `bytes=${start}-${end}`)).body;
}

/**
 * The archive's member table, read from its tail.
 *
 * Throws on ZIP64 rather than guessing: these archives are comfortably under
 * the 4 GB/65535-entry limits today, and silently mis-parsing a ZIP64 offset
 * would produce garbage that looks like data.
 */
function parseCentralDirectory(tail: Buffer, archiveSize: number): ZipMemberEntry[] {
  const eocd = tail.lastIndexOf("PK\x05\x06", tail.length, "binary");
  if (eocd < 0) throw new Error("no end-of-central-directory in the fetched tail");
  const entryCount = tail.readUInt16LE(eocd + 10);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error("ZIP64 archive — this reader does not support it");
  }
  const base = archiveSize - tail.length;
  let cursor = directoryOffset - base;
  if (cursor < 0) throw new Error("central directory is outside the fetched tail; refetch more");

  const entries: ZipMemberEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (tail.subarray(cursor, cursor + 4).toString("binary") !== "PK\x01\x02") break;
    const compressionMethod = tail.readUInt16LE(cursor + 10);
    const compressedSize = tail.readUInt32LE(cursor + 20);
    const uncompressedSize = tail.readUInt32LE(cursor + 24);
    const nameLength = tail.readUInt16LE(cursor + 28);
    const extraLength = tail.readUInt16LE(cursor + 30);
    const commentLength = tail.readUInt16LE(cursor + 32);
    const localHeaderOffset = tail.readUInt32LE(cursor + 42);
    entries.push({
      name: tail.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      compressionMethod,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function listNportMembers(http: SecHttp, url: string): Promise<ZipMemberEntry[]> {
  // A suffix range asks for "the last N bytes" without knowing the length, so
  // the directory and the archive size arrive in one request.
  const { body, total } = await fetchRange(http, url, `bytes=-${CENTRAL_DIRECTORY_TAIL_BYTES}`);
  return parseCentralDirectory(body, total);
}

/**
 * Inflate one member, fetching only its bytes.
 *
 * The local header repeats the name and extra-field lengths and they are NOT
 * always the same as the central directory's, so they are read from the local
 * header itself — using the central directory's would slice into the payload.
 */
async function readMember(http: SecHttp, url: string, entry: ZipMemberEntry): Promise<Buffer> {
  // 30-byte local header + name + extra, then the payload. Over-fetch the
  // header, then take the payload in one further range.
  const header = await fetchBytes(http, url, entry.localHeaderOffset, entry.localHeaderOffset + 29);
  if (header.subarray(0, 4).toString("binary") !== "PK\x03\x04") {
    throw new Error(`${entry.name}: local header not found at ${entry.localHeaderOffset}`);
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const payloadStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const payload = await fetchBytes(http, url, payloadStart, payloadStart + entry.compressedSize - 1);

  if (entry.compressionMethod === 0) return payload;
  if (entry.compressionMethod !== 8) {
    throw new Error(`${entry.name}: unsupported compression method ${entry.compressionMethod}`);
  }
  const inflated = inflateRawSync(payload, { maxOutputLength: entry.uncompressedSize + 1024 });
  if (inflated.byteLength !== entry.uncompressedSize) {
    throw new Error(
      `${entry.name}: inflated ${inflated.byteLength} bytes, directory says ${entry.uncompressedSize}`,
    );
  }
  return inflated;
}

/**
 * Fetch and inflate the named members of a quarter's ZIP. Asserts every
 * requested member was present — a silently missing one would read as an empty
 * quarter rather than a broken fetch.
 */
export async function fetchNportMembers(
  http: SecHttp,
  url: string,
  names: readonly string[],
): Promise<Map<string, Buffer>> {
  const entries = await listNportMembers(http, url);
  const wanted = new Map<string, ZipMemberEntry>();
  for (const name of names) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      throw new Error(`${url} has no member ${name} (has: ${entries.map((e) => e.name).join(", ")})`);
    }
    wanted.set(name, entry);
  }

  const members = new Map<string, Buffer>();
  for (const [name, entry] of wanted) {
    members.set(name, await readMember(http, url, entry));
  }
  return members;
}
