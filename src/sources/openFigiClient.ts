/**
 * OpenFIGI's CUSIP mapping API.
 *
 * SEC's N-PORT data sets resolve the 13F CUSIPs that registered funds hold,
 * which is 97%+ of reported value but only ~30k of 142,895 CUSIPs. The residue
 * measured as ~75,000 *equity-like* CUSIPs, not bonds, so it is a mapping gap
 * rather than a classification one. OpenFIGI is a permanent identifier registry
 * rather than a point-in-time holdings snapshot, which is exactly what a
 * long-dead microcap needs.
 *
 * Three things were measured against the live API on 2026-09-23, and each one
 * shapes this client:
 *
 * 1. **Do NOT pin `exchCode: "US"`.** It collapses the answer to one row, which
 *    is tidy and wrong: a DELISTED US security has no US venue row at all, so
 *    the filter guarantees a miss on exactly the population this exists to
 *    resolve. Measured on Twitter (CUSIP 90184L102, delisted 2022): with the
 *    filter, `No identifier found`; without it, 26 rows across foreign venues,
 *    every one of them TWITTER INC. A first run pinned to US mapped 19,660 of
 *    130,789 — fewer than N-PORT — which is what sent us looking.
 *
 *    Those 26 rows carry 21 distinct `compositeFIGI` (one per venue) and
 *    exactly **one `shareClassFIGI`**. The share class is the stable anchor, and
 *    `lake.security_segments` already carries `share_class_figi`, so the chain
 *    is cusip → shareClassFIGI → security_segments → ticker as of a date.
 *    That is rename-proof, where trusting a Swiss venue's ticker string is not.
 * 2. **The batch ceiling is 10 jobs unauthenticated**, stated by the API's own
 *    response: `HTTP 413 Request may only contain 10 mapping jobs.` A free API
 *    key raises it to 100 and the rate from 25/min to 250/min — a 100x lever,
 *    so `OPENFIGI_API_KEY` is worth setting before any real run.
 * 3. **An unmappable identifier returns `{"warning": "No identifier found."}`**
 *    with HTTP 200 — a clean, distinguishable miss rather than an error.
 *
 * The published per-minute limits are in the table below, read from their
 * documentation once their DNS recovered — for several hours that host
 * SERVFAIL'd from Cloudflare, Google and Quad9 alike, which is worth knowing
 * because it looks exactly like being blocked and is not. This client paces to
 * the published ceiling and never above it, treats 429 as a signal to back off
 * rather than as a missing identifier, and never speeds itself up: being
 * blocked would cost far more than the run saves.
 */

const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
/**
 * Published limits, read from openfigi.com/api/documentation on 2026-09-23 once
 * their DNS recovered. The unauthenticated ceiling of 10 was independently
 * confirmed by the API's own `HTTP 413 Request may only contain 10 mapping
 * jobs.`
 *
 * |            | requests/min | jobs/request | cusips/min |
 * |------------|--------------|--------------|------------|
 * | no key     | 25           | 10           | 250        |
 * | with key   | 250          | 100          | 25,000     |
 *
 * A key is therefore a 100x lever, not a marginal one: 130,789 CUSIPs is 9.5
 * hours unauthenticated and about 6 minutes with one.
 */
export const OPENFIGI_MAX_JOBS_PER_REQUEST = 10;
export const OPENFIGI_MAX_JOBS_PER_REQUEST_WITH_KEY = 100;
/** 25/min. Pace to the published limit rather than under it, but never over. */
const DEFAULT_REQUEST_INTERVAL_MS = 2_400;
/** 250/min. */
const DEFAULT_REQUEST_INTERVAL_MS_WITH_KEY = 240;
const MAX_RETRIES = 4;
const RATE_LIMIT_BACKOFF_MS = 60_000;

export type FigiMappingOutcome = "mapped" | "not_found";

export interface FigiMapping {
  cusip: string;
  outcome: FigiMappingOutcome;
  /**
   * The stable anchor: one share class across every venue a security trades on.
   * Joins to `lake.security_segments.share_class_figi`.
   */
  shareClassFigi: string | null;
  /** The US composite listing's ticker when one exists — absent for delisted names. */
  usTicker: string | null;
  /**
   * Every distinct ticker across every venue, deduped. Kept whole rather than
   * reduced to one, for the same reason the N-PORT crosswalk keeps both symbols
   * of a dual-class pair: the dated identity model is what should pick.
   */
  tickers: string[];
  securityType: string | null;
  marketSector: string | null;
  name: string | null;
  /** How many venue rows OpenFIGI returned — 0 means not found. */
  venueRows: number;
}

interface OpenFigiRow {
  figi?: string;
  exchCode?: string;
  ticker?: string;
  name?: string;
  compositeFIGI?: string;
  shareClassFIGI?: string;
  securityType?: string;
  securityType2?: string;
  marketSector?: string;
}

interface OpenFigiResult {
  data?: OpenFigiRow[];
  warning?: string;
  error?: string;
}

interface FigiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface OpenFigiClientOptions {
  /** Milliseconds between requests. Raise the rate only deliberately. */
  minRequestIntervalMs?: number;
  apiKey?: string | undefined;
  /** Overridable so the suite never needs the network. */
  fetcher?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FigiResponse>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenFigiClient {
  private readonly fetcher: NonNullable<OpenFigiClientOptions["fetcher"]>;
  private readonly headers: Record<string, string>;
  private readonly minRequestIntervalMs: number;
  private readonly maxJobsPerRequest: number;
  private nextRequestAt = 0;
  private rateLimitHits = 0;

  constructor(options: OpenFigiClientOptions = {}) {
    const keyed = Boolean(options.apiKey);
    this.minRequestIntervalMs =
      options.minRequestIntervalMs ??
      (keyed ? DEFAULT_REQUEST_INTERVAL_MS_WITH_KEY : DEFAULT_REQUEST_INTERVAL_MS);
    this.maxJobsPerRequest = keyed
      ? OPENFIGI_MAX_JOBS_PER_REQUEST_WITH_KEY
      : OPENFIGI_MAX_JOBS_PER_REQUEST;
    this.headers = {
      "Content-Type": "application/json",
      ...(options.apiKey ? { "X-OPENFIGI-APIKEY": options.apiKey } : {}),
    };
    this.fetcher =
      options.fetcher ??
      ((url, init) => fetch(url, init) as unknown as Promise<FigiResponse>);
  }

  get observedRateLimitHits(): number {
    return this.rateLimitHits;
  }

  private async pace(): Promise<void> {
    const wait = this.nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
  }

  /**
   * Map up to `OPENFIGI_MAX_JOBS_PER_REQUEST` CUSIPs.
   *
   * Returns one entry per input, in input order, so a caller can pair results
   * with requests without matching on identifiers. A request-level failure
   * throws — it must not be recorded as `not_found`, because a receipt saying
   * "no such security" is permanent and a network blip is not.
   */
  async mapBatch(cusips: readonly string[]): Promise<FigiMapping[]> {
    if (cusips.length === 0) return [];
    if (cusips.length > this.maxJobsPerRequest) {
      throw new Error(`batch of ${cusips.length} exceeds the ${this.maxJobsPerRequest}-job ceiling`);
    }

    // No exchCode: see the note above. Pinning it loses every delisted name.
    const body = cusips.map((cusip) => ({
      idType: "ID_CUSIP",
      idValue: cusip,
    }));

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.pace();
      let status: number | undefined;
      try {
        const response = await this.fetcher(OPENFIGI_MAPPING_URL, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
        });
        status = response.status;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const results = (await response.json()) as OpenFigiResult[];
        if (!Array.isArray(results) || results.length !== cusips.length) {
          throw new Error(`expected ${cusips.length} results, got ${Array.isArray(results) ? results.length : "non-array"}`);
        }
        return results.map((result, index) => this.toMapping(cusips[index]!, result));
      } catch (error: unknown) {
        void error;
        if (status === 429) {
          // Slow down rather than hammering: being blocked costs more than the
          // run saves, and we cannot read their published limit to tune against.
          this.rateLimitHits += 1;
          this.nextRequestAt = Date.now() + RATE_LIMIT_BACKOFF_MS;
          if (attempt < MAX_RETRIES) continue;
        }
        if (attempt < MAX_RETRIES && (status === undefined || status >= 500)) {
          await sleep(2_000 * (attempt + 1));
          continue;
        }
        throw new Error(`openfigi mapping failed (HTTP ${status ?? "?"}): ${cusips.join(",")}`);
      }
    }
    throw new Error(`openfigi mapping exhausted retries: ${cusips.join(",")}`);
  }

  private toMapping(cusip: string, result: OpenFigiResult): FigiMapping {
    const rows = result.data ?? [];
    if (rows.length === 0) {
      return {
        cusip,
        outcome: "not_found",
        shareClassFigi: null,
        usTicker: null,
        tickers: [],
        securityType: null,
        marketSector: null,
        name: null,
        venueRows: 0,
      };
    }

    const tickers = [
      ...new Set(
        rows
          .map((row) => row.ticker?.trim().toUpperCase())
          .filter((ticker): ticker is string => Boolean(ticker)),
      ),
    ].sort();
    const usRow = rows.find((row) => row.exchCode === "US");
    // One share class is the expected case; if venues disagree, take the most
    // common rather than the first, so row order cannot decide identity.
    const shareClassCounts = new Map<string, number>();
    for (const row of rows) {
      const figi = row.shareClassFIGI;
      if (figi) shareClassCounts.set(figi, (shareClassCounts.get(figi) ?? 0) + 1);
    }
    const shareClassFigi =
      [...shareClassCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const representative = usRow ?? rows[0]!;

    return {
      cusip,
      outcome: "mapped",
      shareClassFigi,
      usTicker: usRow?.ticker?.trim().toUpperCase() ?? null,
      tickers,
      // securityType2 is the coarser family ("Common Stock", "Corporate Bond");
      // securityType is the specific one. Keep the specific, fall back coarse.
      securityType: representative.securityType ?? representative.securityType2 ?? null,
      marketSector: representative.marketSector ?? null,
      name: representative.name ?? null,
      venueRows: rows.length,
    };
  }
}

export function openFigiJobsPerRequest(apiKey: string | undefined): number {
  return apiKey ? OPENFIGI_MAX_JOBS_PER_REQUEST_WITH_KEY : OPENFIGI_MAX_JOBS_PER_REQUEST;
}

export function chunkCusips(cusips: readonly string[], size = OPENFIGI_MAX_JOBS_PER_REQUEST): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < cusips.length; index += size) {
    batches.push([...cusips.slice(index, index + size)]);
  }
  return batches;
}
