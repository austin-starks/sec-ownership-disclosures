import { SEC_DATASET_AVAILABILITY_SOURCE, type Form345DatasetRows } from "../extraction/form345Dataset";
import { SEC_ACCEPTANCE_AVAILABILITY_SOURCE } from "../extraction/form4Xml";

/**
 * One availability source per accession in the insider tables.
 *
 * EDGAR's daily submission states the acceptance time; the quarterly data set
 * that later covers the same accession states only its filing date, which is
 * later. An accession already read from EDGAR therefore keeps its acceptance-time
 * rows when the data set is published. Within one source, the incoming read
 * replaces the existing one.
 *
 * The merge is not bound to one year: the two sources can put the same accession
 * in different year shards (an evening acceptance on December 31 is filed the
 * next business day), so callers pass the rows of every year that could hold an
 * accession and bucket the result afterwards.
 */
const SOURCE_RANK: Readonly<Record<string, number>> = {
  [SEC_DATASET_AVAILABILITY_SOURCE]: 1,
  [SEC_ACCEPTANCE_AVAILABILITY_SOURCE]: 2,
};

function sourceRank(source: string): number {
  const rank = SOURCE_RANK[source];
  if (rank === undefined) throw new Error(`Unknown insider availability source "${source}"`);
  return rank;
}

function accessionSources(rows: Form345DatasetRows): Map<string, string> {
  const sources = new Map<string, string>();
  for (const row of [...rows.filings, ...rows.transactions]) {
    const current = sources.get(row.accession);
    if (current !== undefined && current !== row.availabilitySource) {
      throw new Error(`Accession ${row.accession} mixes availability sources ${current} and ${row.availabilitySource}`);
    }
    sources.set(row.accession, row.availabilitySource);
  }
  return sources;
}

export function mergeInsiderRows(existing: Form345DatasetRows, incoming: Form345DatasetRows): Form345DatasetRows {
  const existingSources = accessionSources(existing);
  const taken = new Set(
    [...accessionSources(incoming)]
      .filter(([accession, source]) => {
        const current = existingSources.get(accession);
        return current === undefined || sourceRank(source) >= sourceRank(current);
      })
      .map(([accession]) => accession)
  );
  const kept = (row: { accession: string }): boolean => !taken.has(row.accession);
  const takenRow = (row: { accession: string }): boolean => taken.has(row.accession);
  return {
    filings: [...existing.filings.filter(kept), ...incoming.filings.filter(takenRow)],
    transactions: [...existing.transactions.filter(kept), ...incoming.transactions.filter(takenRow)],
  };
}
