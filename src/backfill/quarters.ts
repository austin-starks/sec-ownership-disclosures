/**
 * Enumerating backfill work without scraping listing pages at runtime.
 *
 * Form 3/4/5 quarters are a pure calendar walk: callers walk forward until a
 * quarter 404s (the service's verified contract), so the list is generated,
 * never fetched. 13F has two naming eras — classic `{YYYY}q{N}` back to 2013Q2
 * plus acceptance-window labels for recent quarters — so windows come from the
 * datasets index page (`discoverThirteenFWindows`), parsed from the same HTML
 * a browser would render.
 *
 * Identities (`form345:2025q4`, `form13f:2013q2`) are shard keys: stable
 * hashes of identity, never positions, so re-listing never moves work.
 */

export interface QuarterIdentity {
  dataset: "form345" | "form13f";
  /** `2025q4` classic, or a window stem such as `01mar2026-31may2026_form13f`. */
  label: string;
  /** Shard + receipt identity. */
  identity: string;
}

export interface YearQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

function compareQuarters(left: YearQuarter, right: YearQuarter): number {
  return left.year - right.year || left.quarter - right.quarter;
}

function walkQuarters(from: YearQuarter, to: YearQuarter): YearQuarter[] {
  if (compareQuarters(from, to) > 0) {
    throw new Error(`quarter range runs backwards: ${from.year}q${from.quarter} to ${to.year}q${to.quarter}`);
  }
  const out: YearQuarter[] = [];
  let current = { ...from };
  while (compareQuarters(current, to) <= 0) {
    out.push({ ...current });
    current = current.quarter === 4
      ? { year: current.year + 1, quarter: 1 }
      : { year: current.year, quarter: ((current.quarter + 1) as 1 | 2 | 3 | 4) };
  }
  return out;
}

/** Classic Form 3/4/5 quarters between two endpoints, inclusive. */
export function form345QuarterIdentities(from: YearQuarter, to: YearQuarter): QuarterIdentity[] {
  return walkQuarters(from, to).map(({ year, quarter }) => ({
    dataset: "form345",
    label: `${year}q${quarter}`,
    identity: `form345:${year}q${quarter}`,
  }));
}

/** Classic Form 13F quarters between two endpoints, inclusive. */
export function thirteenFQuarterIdentities(from: YearQuarter, to: YearQuarter): QuarterIdentity[] {
  return walkQuarters(from, to).map(({ year, quarter }) => ({
    dataset: "form13f",
    label: `${year}q${quarter}`,
    identity: `form13f:${year}q${quarter}`,
  }));
}

const WINDOW_HREF = /href="[^"]*\/([A-Za-z0-9_-]+_form13f)\.zip"/g;

/**
 * Window stems from a datasets index page: both the classic era
 * (`2013q2_form13f`) and acceptance windows (`01mar2026-31may2026_form13f`),
 * deduplicated and sorted. Anything that is not a Download link to a
 * `_form13f.zip` (readme, parent dirs, traversal) is ignored.
 */
export function discoverThirteenFWindows(indexHtml: string): string[] {
  const stems = new Set<string>();
  for (const match of indexHtml.matchAll(WINDOW_HREF)) {
    const stem = match[1];
    if (stem && !stem.includes("..")) stems.add(stem);
  }
  return [...stems].sort();
}
