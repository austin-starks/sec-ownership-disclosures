/**
 * CUSIP → ticker pairs, read out of SEC's N-PORT quarterly data sets.
 *
 * `institutional_holdings` (13F) is keyed by CUSIP and carries no ticker, which
 * is why 124M rows have never reached the Rust engine. N-PORT is the public
 * bulk source that pairs the two, because registered funds report both:
 *
 *   FUND_REPORTED_HOLDING.tsv   HOLDING_ID, ISSUER_CUSIP, ISSUER_NAME
 *            ⋈ HOLDING_ID
 *   IDENTIFIERS.tsv             HOLDING_ID, IDENTIFIER_TICKER, IDENTIFIER_ISIN
 *
 * Two shapes in the source drive this file:
 *
 * 1. **A holding's identifiers arrive on separate rows.** HOLDING_ID 167654489
 *    has one row carrying `US15118V2079` and another carrying `CELH`. So the
 *    identifier table is folded per holding before it is joined, never read as
 *    one-row-per-holding.
 * 2. **The raw holdings member is 910 MB.** Decoding that to a JS string costs
 *    ~1.8 GB in UTF-16 and risks the string limit outright, so both members are
 *    walked line by line over the Buffer and only the columns in use are
 *    decoded.
 *
 * The ISIN is a free cross-check rather than a second source: a US ISIN is
 * `US` + the 9-character CUSIP + a check digit, so a row whose ISIN disagrees
 * with its stated CUSIP is a parse error somewhere and is dropped rather than
 * guessed at.
 */

export interface CusipTickerPair {
  cusip: string;
  ticker: string;
  issuerName: string;
  /** Present when the filing also carried an ISIN, which we verify against the CUSIP. */
  isin: string | null;
  /** e.g. `nport:2026q2` — provenance travels with the pair. */
  source: string;
}

export interface CrosswalkStats {
  holdingRows: number;
  identifierRows: number;
  holdingsWithTicker: number;
  pairs: number;
  distinctCusips: number;
  /** Rows whose ISIN did not agree with the stated CUSIP — dropped. */
  isinMismatches: number;
  /** Rows with a placeholder CUSIP (all zeroes / N/A), which SEC uses for unidentified holdings. */
  placeholderCusips: number;
  /**
   * Rows whose field count did not match their header — dropped.
   *
   * A TSV row carrying an unescaped tab shifts every later column, so
   * ISSUER_CUSIP would be read out of the wrong field and emit a confidently
   * WRONG cusip-to-ticker pair. The ISIN cross-check only catches that when an
   * ISIN is present, so the shape is checked directly.
   */
  fieldCountMismatches: number;
}

const TAB = 0x09;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** Walk a TSV Buffer, handing each line's raw field slices to `onRow`. */
function forEachRow(
  buffer: Buffer,
  onRow: (fields: Buffer[], lineNumber: number) => void,
): void {
  let start = 0;
  let lineNumber = 0;
  while (start < buffer.length) {
    let end = buffer.indexOf(NEWLINE, start);
    if (end === -1) end = buffer.length;
    let lineEnd = end;
    if (lineEnd > start && buffer[lineEnd - 1] === CARRIAGE_RETURN) lineEnd -= 1;

    if (lineEnd > start) {
      const fields: Buffer[] = [];
      let fieldStart = start;
      for (let index = start; index <= lineEnd; index += 1) {
        if (index === lineEnd || buffer[index] === TAB) {
          fields.push(buffer.subarray(fieldStart, index));
          fieldStart = index + 1;
        }
      }
      onRow(fields, lineNumber);
      lineNumber += 1;
    }
    start = end + 1;
  }
}

function headerIndex(fields: Buffer[], name: string): number {
  const index = fields.findIndex((field) => field.toString("utf8").trim() === name);
  if (index === -1) {
    throw new Error(`column ${name} not found in [${fields.map((f) => f.toString("utf8")).join(", ")}]`);
  }
  return index;
}

function text(fields: Buffer[], index: number): string {
  const field = fields[index];
  return field === undefined ? "" : field.toString("utf8").trim();
}

/**
 * SEC uses an all-nines or all-zeroes CUSIP for holdings it could not identify
 * (a currency future, a bank loan, an internal cash sweep). Those are not
 * securities and must not enter the crosswalk.
 */
function isPlaceholderCusip(cusip: string): boolean {
  return (
    cusip.length !== 9 ||
    /^0+$/.test(cusip) ||
    /^9+$/.test(cusip) ||
    cusip.toUpperCase() === "N/A" ||
    cusip.toUpperCase() === "NONE"
  );
}

/** `US` + 9-char CUSIP + check digit. Returns null when the ISIN is not a US one. */
export function cusipFromIsin(isin: string): string | null {
  if (isin.length !== 12 || !isin.startsWith("US")) return null;
  return isin.slice(2, 11);
}

interface HoldingIdentifiers {
  ticker?: string;
  isin?: string;
}

/**
 * Fold IDENTIFIERS.tsv into one record per holding.
 *
 * Only holdings that actually name a ticker are retained — the rest cannot
 * contribute a pair, and keeping them would hold millions of dead entries while
 * the 910 MB holdings member streams past.
 */
interface FoldedIdentifiers {
  byHolding: Map<string, HoldingIdentifiers>;
  rows: number;
  malformedRows: number;
}

function foldIdentifiers(identifiers: Buffer): FoldedIdentifiers {
  const byHolding = new Map<string, HoldingIdentifiers>();
  let rows = 0;
  let malformedRows = 0;
  let holdingIdIndex = -1;
  let tickerIndex = -1;
  let isinIndex = -1;
  let headerFieldCount = -1;

  forEachRow(identifiers, (fields, lineNumber) => {
    if (lineNumber === 0) {
      holdingIdIndex = headerIndex(fields, "HOLDING_ID");
      tickerIndex = headerIndex(fields, "IDENTIFIER_TICKER");
      isinIndex = headerIndex(fields, "IDENTIFIER_ISIN");
      headerFieldCount = fields.length;
      return;
    }
    rows += 1;
    if (fields.length !== headerFieldCount) {
      malformedRows += 1;
      return;
    }
    const ticker = text(fields, tickerIndex);
    const isin = text(fields, isinIndex);
    if (!ticker && !isin) return;

    const holdingId = text(fields, holdingIdIndex);
    if (!holdingId) return;
    const existing = byHolding.get(holdingId) ?? {};
    if (ticker) existing.ticker = ticker.toUpperCase();
    if (isin) existing.isin = isin.toUpperCase();
    byHolding.set(holdingId, existing);
  });

  // Drop the ISIN-only holdings now that the fold is complete: they were needed
  // during the fold (a ticker row may arrive after its ISIN row) but contribute
  // nothing to a crosswalk.
  for (const [holdingId, record] of byHolding) {
    if (!record.ticker) byHolding.delete(holdingId);
  }
  return { byHolding, rows, malformedRows };
}

export interface CrosswalkResult {
  pairs: CusipTickerPair[];
  stats: CrosswalkStats;
}

export function buildCrosswalkFromMembers(
  holdingMember: Buffer,
  identifiersMember: Buffer,
  source: string,
): CrosswalkResult {
  const folded = foldIdentifiers(identifiersMember);
  const identifiers = folded.byHolding;

  const stats: CrosswalkStats = {
    holdingRows: 0,
    identifierRows: folded.rows,
    holdingsWithTicker: identifiers.size,
    pairs: 0,
    distinctCusips: 0,
    isinMismatches: 0,
    placeholderCusips: 0,
    fieldCountMismatches: folded.malformedRows,
  };

  // Deduped on the way in: a quarter names the same (cusip, ticker) once per
  // fund holding it, which is thousands of times for a mega cap.
  const seen = new Map<string, CusipTickerPair>();
  let holdingIdIndex = -1;
  let cusipIndex = -1;
  let issuerNameIndex = -1;
  let holdingFieldCount = -1;

  forEachRow(holdingMember, (fields, lineNumber) => {
    if (lineNumber === 0) {
      holdingIdIndex = headerIndex(fields, "HOLDING_ID");
      cusipIndex = headerIndex(fields, "ISSUER_CUSIP");
      issuerNameIndex = headerIndex(fields, "ISSUER_NAME");
      holdingFieldCount = fields.length;
      return;
    }
    stats.holdingRows += 1;
    if (fields.length !== holdingFieldCount) {
      stats.fieldCountMismatches += 1;
      return;
    }

    const holdingId = text(fields, holdingIdIndex);
    const identifier = identifiers.get(holdingId);
    if (!identifier?.ticker) return;

    const cusip = text(fields, cusipIndex).toUpperCase();
    if (isPlaceholderCusip(cusip)) {
      stats.placeholderCusips += 1;
      return;
    }

    const isin = identifier.isin ?? null;
    const isinCusip = isin ? cusipFromIsin(isin) : null;
    if (isinCusip && isinCusip !== cusip) {
      // The filing contradicts itself. Dropping is right: a wrong ticker on a
      // holding is worse than a missing one, and it would be invisible after
      // the join.
      stats.isinMismatches += 1;
      return;
    }

    const key = `${cusip}\u0000${identifier.ticker}`;
    if (!seen.has(key)) {
      seen.set(key, {
        cusip,
        ticker: identifier.ticker,
        issuerName: text(fields, issuerNameIndex),
        isin,
        source,
      });
    }
  });

  const pairs = [...seen.values()];
  stats.pairs = pairs.length;
  stats.distinctCusips = new Set(pairs.map((pair) => pair.cusip)).size;
  return { pairs, stats };
}
