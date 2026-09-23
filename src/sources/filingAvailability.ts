export type FilingAvailabilitySource =
  | "submissions"
  | "filed-date-fallback";

/**
 * SEC's `acceptanceDateTime` legitimately PRECEDES the assigned `filingDate`.
 *
 * Filing after the 17:30 ET cutoff gets stamped with the next business day, so
 * a 10-Q accepted Thursday 18:44 ET carries a Friday filing date, and one
 * accepted Friday evening carries the following Monday's or Tuesday's.
 *
 * The previous guard required `accepted >= filed` and rejected every such
 * filing, falling back to `filed + 24h`. Measured across the affected
 * population: 966 of 966 accessions had an acceptance time and ALL of them were
 * negative — median -1.7h, min -50.4h. So the guard rejected 100% of a
 * population that is entirely the normal after-hours pattern, and hid each
 * filing for an extra day, or four across a weekend.
 *
 * That is not classic look-ahead — nothing is revealed early — but a systematic
 * availability LAG corrupts point-in-time work just as reliably: the backtest
 * trades a day late while production trades on time.
 *
 * -96h covers every observed case (worst seen -50.4h) with margin for a long
 * weekend or holiday; the forward bound is unchanged.
 */
export const MAX_ACCEPTANCE_BEFORE_FILED_MS = 4 * 86_400_000;
export const MAX_ACCEPTANCE_AFTER_FILED_MS = 2 * 86_400_000;

/**
 * Availability is strictly AFTER acceptance. Consumers use `<=` when selecting
 * statements as of a timestamp, so without this a filing accepted exactly at a
 * bar's timestamp would be visible in that same bar.
 */
export const AVAILABILITY_EPSILON_MS = 60_000;

export function filingAvailability(
  accession: string,
  filed: Date,
  acceptedByAccession: ReadonlyMap<string, Date>,
): { availableAt: Date; availabilitySource: FilingAvailabilitySource } {
  const accepted = acceptedByAccession.get(accession);
  if (
    accepted &&
    Number.isFinite(accepted.getTime()) &&
    accepted.getTime() >= filed.getTime() - MAX_ACCEPTANCE_BEFORE_FILED_MS &&
    accepted.getTime() <= filed.getTime() + MAX_ACCEPTANCE_AFTER_FILED_MS
  ) {
    return {
      availableAt: new Date(accepted.getTime() + AVAILABILITY_EPSILON_MS),
      availabilitySource: "submissions",
    };
  }
  return {
    availableAt: new Date(filed.getTime() + 86_400_000),
    availabilitySource: "filed-date-fallback",
  };
}
