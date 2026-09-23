# sec-ownership-disclosures

Build a local, queryable lake of SEC ownership disclosures — insider Form 3/4/5
transactions and institutional 13F holdings — from official EDGAR sources, with
the one column most datasets leave out: **when each filing could first have been
known**.

One command downloads the published snapshot as SQLite; another builds the
whole lake from EDGAR yourself.

[![npm](https://img.shields.io/npm/v/sec-ownership-disclosures)](https://www.npmjs.com/package/sec-ownership-disclosures)
[![CI](https://github.com/austin-starks/sec-ownership-disclosures/actions/workflows/ci.yml/badge.svg)](https://github.com/austin-starks/sec-ownership-disclosures/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/austin-starks/sec-ownership-disclosures/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)](https://nodejs.org/)

<p align="center">
  <a href="#quick-start">
    <img src="https://nexustrade-prod.nyc3.cdn.digitaloceanspaces.com/open-source/sec-ownership-disclosures/readme-demo-8ebcc497e31d.gif" alt="Back-fill twenty years of SEC insider filings with one resumable command, audited by re-parsing the archives" width="100%" />
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
| `insider_transactions` | 10,045,180 | one non-derivative/derivative leg | 2006Q1–2026Q2 |
| `insider_filings` | 4,839,497 | one filing × reporting owner | 2006Q1–2026Q2 |
| `institutional_holdings` | 124,012,468 | one information-table leg | 2013Q2–present |
| `institutional_filings` | 409,685 | one 13F submission | 2013Q2–present |

Twenty years of Form 3/4/5, from 81 quarterly data sets, plus 54 windows of 13F.

## What you can investigate

- **Which officers bought their own stock with their own money**, as opposed to
  receiving it. Measured over the 9,923,755-leg build, only **894,244 are
  open-market purchases**
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

There are two doors, and they answer different questions.

### 1. Download the published dataset

No SEC etiquette, no twenty-year backfill, no credentials:

```bash
npx sec-ownership-disclosures download --sqlite
```

That fetches [the published
dataset](https://huggingface.co/datasets/austin-starks/sec-ownership-disclosures),
verifies every file against the `sha256` in `snapshot.json`, and leaves a SQLite
database you can query immediately:

```bash
sqlite3 sec-ownership-data/sec-ownership.db \
  "SELECT issuerTicker, count(*) FROM insider_transactions
    WHERE transactionCode = 'P' AND availableAt <= '2024-06-30'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
```

The whole dataset is a few GB, so start with a slice — `--table
insider_transactions`, `--year 2024`, or both. A file already on disk with the
right digest is reused, so an interrupted download resumes for free, and the
digest check means a truncated or tampered mirror fails instead of quietly
answering the wrong question.

### 2. Build the lake yourself

The published dataset is a snapshot. Running the pipeline is how you get a lake
that is current, that you control, and that you can audit line by line:

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
- **FIGI is empty before 2024.** Measured per year against the published table,
  the fill rate is `0.000000000000` for every year from 2013 through 2023, and
  the 24,004 CUSIPs that carry one are all 2024 or later — FIGI became an
  optional 13F column in the 2023 amendments. The "3.7% overall" figure this
  file used to quote was arithmetically true and read as thinly spread, when it
  is in fact *absent for eleven of fourteen years*. So FIGI cannot bridge to a
  ticker across the history, and 0.3.0 resolves the CUSIP instead — see below.

## Resolving a CUSIP to a ticker

A 13F names a security by CUSIP and nothing else. No ticker, no CIK. That makes
the holdings table unjoinable to prices and unusable in a screener until
something resolves it, so the package resolves it rather than leaving it to the
reader.

Two sources, because neither covers the history alone:

| source | what it is | distinct CUSIPs it contributes |
|---|---|---|
| **N-PORT** | SEC's own quarterly fund holdings, which print CUSIP *and* ticker on the same holding | 60,763 |
| **OpenFIGI** | OpenFIGI's `/v3/mapping`, for CUSIPs no registered fund held | 42,748 |
| | **combined** | **103,511** |

Measured from one quarter of N-PORT (2026q2), so N-PORT's share grows as more
quarters are folded in. It is preferred and runs first: it is SEC data pairing
the two identifiers in one row. OpenFIGI fills what no registered fund held,
and contributed 42,748 CUSIPs N-PORT did not already cover — the counts above
are disjoint, not two totals.

```ts
const rows = await parseThirteenFDataset(zip, archiveKey);
normalizeThirteenFValuesToDollars(rows);

const url = nportDatasetUrl(2025, 2);
const members = await fetchNportMembers(http, url, [NPORT_HOLDING_MEMBER, NPORT_IDENTIFIERS_MEMBER]);
const { pairs } = buildCrosswalkFromMembers(
  members.get(NPORT_HOLDING_MEMBER)!,
  members.get(NPORT_IDENTIFIERS_MEMBER)!,
  "nport-2025q2",
);

const report = resolveHoldingTickers(rows, pairs);
```

The same thing with the missing-member guard is
[`examples/resolve-tickers.ts`](./examples/resolve-tickers.ts), which
`npm run typecheck:examples` compiles against the built package — so every
identifier above is checked rather than transcribed.

`fetchNportQuarter` needs `SecHttp.getRange`. An N-PORT quarter is a 440 MB ZIP
holding 32 members, and only two of them pair the identifiers, so the reader
takes the central directory from a 128 KB suffix request and range-fetches just
those two. Implement `getRange` on your HTTP adapter or the call throws saying
so; it will not silently download the whole archive.

**Do not pin `exchCode: "US"` on OpenFIGI.** It excludes delisted securities,
which is most of what a fourteen-year 13F history holds. It cut the mapped set
from 53,468 to 19,660 — Twitter among the casualties.

**Pass spans, not pairs.** `resolveHoldingTickers` matches each holding on its
own `availableAt`, because price history is keyed by the symbol as traded on
that date:

```ts
resolveHoldingTickers(rows, [
  { cusip: "30303M102", ticker: "FB",   fromDate: "2012-05-18", toDate: "2022-06-08" },
  { cusip: "30303M102", ticker: "META", fromDate: "2022-06-09", toDate: null },
]);
```

An undated pair applies to every date, which is only safe for a symbol that has
never changed hands. Measured against SEC's own history, an undated crosswalk
stamps the wrong symbol on **10.68%** of holdings rows: renames make the join
miss, and a reused symbol makes it succeed against a different company. A CUSIP
with no covering span resolves to null on purpose — a null is visible, a wrong
ticker is not.

Where several spans cover one day the first wins, so pass them in the order you
trust. Order alone is not enough, and three traps cost real correctness:

- **Both sources emit Bloomberg composite tickers, `SYM EXCH`.** Do not strip
  the suffix. `CCO CN` is Cameco on Toronto; bare `CCO` is Clear Channel
  Outdoor in the US. Stripping maps a CUSIP onto a different company's prices,
  which then joins cleanly and looks right. Reject a foreign listing instead:
  a null ticker is recoverable where a wrong one is not.
- **Funds type the CUSIP prefix into the ticker field for bonds**, so
  `02090DAA6` "resolves" to `02090DAA`. It joins to nothing and reads as a
  real mapping.
- **OpenFIGI's `tickers[0]` is a foreign venue symbol when `usTicker` is null** —
  `NLYEUR` for Annaly, `AMNBUSD` for American National Bankshares. Do not strip
  the currency either: `STWD`, `ACAD` and `CBRL` all parse as symbol-plus-
  currency and are real US tickers. Validate against a listing table; a pattern
  cannot tell these apart.

Measured over 70,641 CUSIPs, the two sources disagree on 2,421 (3.43%). Where
they do and you hold prices, the price table settles it rather than the
precedence: on that set the preferred source was right 966 times and the other
514, so neither order is correct on its own.

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
