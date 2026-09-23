import { THIRTEEN_F_AVAILABILITY_SOURCE, type ThirteenFDatasetRows } from "../extraction/infoTable";

/**
 * Union of existing year-shard rows with freshly parsed windows. Windows are
 * disjoint accession sets (verified across all 54), so this is idempotent
 * republish protection, not conflict resolution: same key twice means the
 * same filing re-read, and the incoming read replaces the existing one.
 * A row from any other availability source (a future daily path) throws
 * rather than merging silently.
 */
export function mergeHoldingsRows(
  existing: ThirteenFDatasetRows,
  incoming: ThirteenFDatasetRows
): ThirteenFDatasetRows {
  for (const row of [...existing.filings, ...existing.holdings, ...incoming.filings, ...incoming.holdings]) {
    if (row.availabilitySource !== THIRTEEN_F_AVAILABILITY_SOURCE) {
      throw new Error(`Unknown holdings availability source "${row.availabilitySource}"`);
    }
  }
  const filings = new Map<string, (typeof incoming.filings)[number]>();
  for (const filing of [...existing.filings, ...incoming.filings]) filings.set(filing.accession, filing);
  const holdings = new Map<string, (typeof incoming.holdings)[number]>();
  for (const holding of [...existing.holdings, ...incoming.holdings]) {
    holdings.set(`${holding.accession}/${holding.infoTableSk}`, holding);
  }
  return { filings: [...filings.values()], holdings: [...holdings.values()] };
}
