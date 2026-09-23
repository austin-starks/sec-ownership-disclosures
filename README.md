# sec-ownership-disclosures

Build a local, queryable lake of SEC ownership disclosures — insider Form 3/4/5
transactions and institutional 13F holdings — from official EDGAR sources, with
the one column most datasets leave out: **when each filing could first have been
known**.

[![npm](https://img.shields.io/npm/v/sec-ownership-disclosures)](https://www.npmjs.com/package/sec-ownership-disclosures)
[![CI](https://github.com/austin-starks/sec-ownership-disclosures/actions/workflows/ci.yml/badge.svg)](https://github.com/austin-starks/sec-ownership-disclosures/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/austin-starks/sec-ownership-disclosures/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)](https://nodejs.org/)

<p align="center">
  <a href="#quick-start">
    <img src="https://raw.githubusercontent.com/austin-starks/sec-ownership-disclosures/main/graphic/out/readme-demo.gif" alt="Back-fill twenty years of SEC insider filings with one resumable command, audited by re-parsing the archives" width="100%" />
  </a>
</p>

**This is the open-source SEC ownership engine behind
[NexusTrade](https://nexustrade.io).** The package gives you the extraction
pipeline, the audit suite, and a lake you control. NexusTrade adds market data,
natural-language research, screening, backtesting and deployment on top of the
same tables.

It discovers every quarterly data set, archives the raw ZIP content-addressed,
parses both naming eras, writes receipts so a restarted machine resumes where it
stopped, and audits what it wrote by re-parsing the archives rather than
trusting its own counters.

## What is in it, measured

A full backfill of the official sources produces:

| Table | Rows | Grain | Coverage |
|---|---|---|---|
| `insider_transactions` | 9,923,755 | one non-derivative/derivative leg | 2006Q1–2026Q1 |
| `insider_filings` | 4,772,838 | one filing × reporting owner | 2006Q1–2026Q1 |
| `institutional_holdings` | 124,012,468 | one information-table leg | 2013Q2–present |
| `institutional_filings` | 409,685 | one 13F submission | 2013Q2–present |

Twenty years of Form 3/4/5, from 81 quarterly data sets, plus 54 windows of 13F.

## What you can investigate

- **Which officers bought their own stock with their own money**, as opposed to
  receiving it. Of 9.9M insider legs, only **894,244 are open-market purchases**
  (`transactionCode = 'P'`). Grants are 2.48M, option exercises 1.96M and sales
  2.60M. A dataset that calls all of those "insider buying" is measuring
  compensation, not conviction.
- **What a manager held, and when you could have known it.** 13F originals file
  a median of 42 days after period end (p95 48 days, over 393,202 originals), so
  a February filing about December holdings belongs to February.
- **Who amended, and how late.** Amendments are versions, never overwrites:
  every 4/A and 13F-HR/A keeps its own row and its own availability. Amendment
  lag runs p50 115 days, p95 1,121 days.
- **Cluster buying before news**, insider participation across a sector, or
  manager concentration changes quarter over quarter — all joinable to prices by
  CIK, accession and CUSIP.

## Quick start

```bash
npm install sec-ownership-disclosures
```

Back-fill the insider data sets into a local directory:

```bash
# dry run: lists the quarters it would fetch and the receipts it already has
npx sec-backfill --dataset form345 --from 2006q1 --to 2026q1 \
  --store fs --fs-root ./sec-lake --round my-backfill

npx sec-backfill --dataset form345 --from 2006q1 --to 2026q1 \
  --store fs --fs-root ./sec-lake --round my-backfill --run
```

Everything is **dry run by default**; `--run` is what writes. `--store`
defaults to `tigris` — pass `--store fs --fs-root <dir>` to keep everything on
local disk. `--round` names the receipt set, and defaults to
`backfill-{today}`.

Audit what landed, by re-parsing the archives rather than trusting the run:

```bash
npx sec-integrity --dataset form345 --store fs --fs-root ./sec-lake --round my-backfill
npx sec-lags --store fs --fs-root ./sec-lake --round my-backfill
```

`sec-integrity` requires `--round`, because it cross-checks the receipts that
round wrote. `sec-lags` reads the SUBMISSION tables only, so it answers the
45-day question without parsing a single information table.

## Resumable and shardable

The backfill writes a receipt per quarter, keyed by content hash. A restarted
machine skips what is receipted, and a second run processes nothing. To spread
twenty years across four machines, split on stable identity hashes:

```bash
npx sec-backfill --dataset form13f --discover --shard 0/4 --round q3 --run
npx sec-backfill --dataset form13f --discover --shard 1/4 --round q3 --run
# ...
```

`--discover` walks forward until the sources 404, so it finds new quarters
without being told the end date.

Because sharding is by hash rather than by position, the shard count can change
between runs without reprocessing.

## Point-in-time, or it is not usable for research

Every row carries `availableAt`: the filing date end-of-day in
America/New_York for quarterly sets. Never the transaction date, never the
period of report.

That distinction is the whole reason this package exists. A Form 4 describes a
trade that happened days earlier; a 13F describes holdings from up to three
months earlier. Joining either on its transaction or period date silently leaks
information no investor had, and any backtest built on it reports returns nobody
could have earned. Filter on `availableAt <= as_of` and the leak is gone.

## Names are labels, never keys

Issuer, owner and manager names can be blank in official filings — a 2020
Trupanion filing carries blank names with valid CIKs. Join on **CIK**,
**accession** and **CUSIP**. The package keeps names verbatim, including the
empty ones, instead of inventing a display value that would then be joined on.

## Use it as a library

```ts
import { parseForm345Dataset } from "sec-ownership-disclosures";

// The second argument is the raw archive key: where this ZIP is stored, kept
// on every row so any number can be traced back to the bytes it came from.
const rows = await parseForm345Dataset(zipBuffer, "sec/raw/2025q4/<sha256>.zip");
console.log(rows.filings.length, rows.transactions.length);
```

Storage and transport are ports, so you can keep your own: a filesystem adapter
and an S3-compatible adapter ship with the package, and `SecHttp` lets you
supply your own client for rate limiting, caching or a proxy. Nothing in the
extraction layer knows where bytes come from.

## Two naming eras, both parsed

SEC changed how these archives are named and laid out. Classic quarters are
`{YYYY}q{N}_form13f.zip`; recent ones are acceptance windows such as
`{01mar2026-31may2026}_form13f.zip`, and they nest their TSVs under a directory
whose name varies. The package detects the prefix rather than assuming it, and
the two eras were verified to be disjoint accession sets (409,685 distinct of
409,685) — sequential eras, no deduplication debt.

## Limits, measured rather than promised

- 13F is long-only, 45-day lagged and manager-aggregated. 5.4% of rows are
  put/call options; the rest are long stock.
- 914,313 zero-position rows (0.7%, including 6,824 placeholder CUSIPs) are
  **preserved, not dropped** — a zeroed position is information.
- 11 of 86,730 13F-NT notice filings carry holdings. Kept verbatim as an
  anomaly class rather than filtered into invisibility.
- 2,870 insider transactions are dated after their filing date (0.03%), 8,187
  have null share counts, and 15 have no transaction code. Kept and flagged.
- FIGI is 3.7% filled overall (12% in the latest window). CUSIP→ticker mapping
  is the remaining work, and the package does not pretend otherwise.

Full detail, with how each number was produced: [METHODOLOGY.md](./METHODOLOGY.md).

## The audit is part of the pipeline

`sec-integrity` re-parses every archived ZIP and checks grain uniqueness, orphan
joins, boundary disjointness for Form 3/4/5 quarters, NT-with-holdings,
placeholder shapes, and code and type inventories. Unknown transaction codes
surface in the report instead of disappearing.

The runner fails a partial audit rather than publishing it. That rule exists
because a label-regex miss once let 43 windows pass as 11, and a green report
over a third of the data is worse than a red one.

## Contributing

Issues and pull requests are welcome. Run `npm test` (68 tests, 20 suites) and
`npm run build` before opening one.

## License

MIT — see [LICENSE](./LICENSE).
