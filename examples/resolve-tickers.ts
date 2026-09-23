/**
 * 13F holdings, with tickers.
 *
 * Typechecked against the built package by `npm run typecheck:examples`, so
 * the README cannot drift from the real API the way it did before 0.3.0.
 */
import {
  NPORT_HOLDING_MEMBER,
  NPORT_IDENTIFIERS_MEMBER,
  buildCrosswalkFromMembers,
  fetchNportMembers,
  nportDatasetUrl,
  normalizeThirteenFValuesToDollars,
  parseThirteenFDataset,
  resolveHoldingTickers,
  type SecHttp,
} from "../dist/index";

export async function holdingsWithTickers(http: SecHttp, zip: Buffer, archiveKey: string) {
  const rows = await parseThirteenFDataset(zip, archiveKey);
  normalizeThirteenFValuesToDollars(rows);

  const url = nportDatasetUrl(2025, 2);
  const members = await fetchNportMembers(http, url, [NPORT_HOLDING_MEMBER, NPORT_IDENTIFIERS_MEMBER]);
  const holdingMember = members.get(NPORT_HOLDING_MEMBER);
  const identifiersMember = members.get(NPORT_IDENTIFIERS_MEMBER);
  if (!holdingMember || !identifiersMember) throw new Error(`${url} is missing a member`);

  const { pairs } = buildCrosswalkFromMembers(holdingMember, identifiersMember, "nport-2025q2");
  const report = resolveHoldingTickers(rows, pairs);
  console.log(`resolved ${report.resolved}, unresolved ${report.unresolved}`);
  return rows;
}
