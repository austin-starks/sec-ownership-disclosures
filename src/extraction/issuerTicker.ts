/**
 * The one symbol a price table can join on, read from `issuerTradingSymbol`.
 *
 * That field is free text typed by the filer, and SEC does not validate it.
 * Measured on the published dataset: 0.8% of 2026 insider transactions and 1.6%
 * of 2015's are not ticker-shaped — `vicr`, `NYSE: KRC`, `(SIRI)`, `"OMEX"`,
 * `LEN, LEN.B`, `Z AND ZG`, `N O G`, `none`, `n/a`, a bare CIK. A join on the raw
 * value silently drops every one of those trades.
 *
 * Only the row's own text is read, so the result is as point-in-time as the
 * filing. When a filer lists several share classes the FIRST is taken; the
 * filed text stays in `issuerTicker` for anyone who needs the list. A value with
 * no symbol in it — usually a private issuer — resolves to null rather than to
 * a guess.
 */

const SYMBOL = /^[A-Z]{1,5}(?:[.\-/][A-Z0-9]{1,2})?$/;
/**
 * `MTLp`, `CELGr`, `WRKw`: a lowercase trailing letter is the share class, the
 * same convention `resolveHoldingTickers` keeps. Uppercasing would price the
 * preferred or the when-issued line as the common stock.
 */
const CLASS_SUFFIX = /^[A-Z]{1,5}[a-z]$/;

/** Whole values that mean "this issuer has no ticker". */
const PLACEHOLDERS = new Set(["NONE", "N/A", "NA", "N.A.", "NULL", "NIL", "NOT APPLICABLE", "NOT TRADED", "-", "--"]);

/** `NYSE: KRC`, `ASX:LNW`, `NASDAQ:SVC` — the venue is not part of the symbol. */
function withoutVenue(value: string): string {
  const colon = value.lastIndexOf(":");
  return colon >= 0 ? value.slice(colon + 1) : value;
}

/** `GTII/GTBIF` lists two symbols; `BRK/B` is one symbol with its class. */
function splitSlashList(token: string): string[] {
  const parts = token.split("/");
  const [, classPart] = parts;
  if (parts.length === 2 && classPart !== undefined && classPart.length <= 2) return [token];
  return parts;
}

export function resolveIssuerTicker(filed: string | null | undefined): string | null {
  if (!filed) return null;
  const trimmed = filed.trim();
  if (CLASS_SUFFIX.test(trimmed)) return trimmed;
  const cleaned = withoutVenue(
    trimmed
      .toUpperCase()
      .replace(/["()[\]*]/g, " ")
      // `BF'B` uses an apostrophe as the class separator.
      .replace(/([A-Z])'([A-Z])$/, "$1.$2")
      .replace(/'/g, "")
  ).trim();
  if (!cleaned || PLACEHOLDERS.has(cleaned)) return null;

  const tokens = cleaned
    .split(/\s*(?:,|;|&|\bAND\b|\s)\s*/)
    .filter(Boolean)
    .flatMap(splitSlashList);
  // `N O G`: a symbol typed one letter at a time.
  if (tokens.length > 1 && tokens.every((token) => /^[A-Z]$/.test(token))) {
    const joined = tokens.join("");
    return SYMBOL.test(joined) ? joined : null;
  }
  return tokens.find((token) => SYMBOL.test(token) && !PLACEHOLDERS.has(token)) ?? null;
}
