# Changelog

## 0.3.0

### The package can now resolve tickers itself

13F holdings are keyed by CUSIP and the form carries no ticker, so a lake built
from this package could not be joined to prices, screened, or used in a
strategy. Everything needed to close that gap lived in a private pipeline;
now it is here.

- **Added** `resolvedTicker` and `valueUnitSource` to `institutional_holdings`.
- **Added** `sources/nportDatasets` — SEC's Form N-PORT data sets, the public
  bulk source that pairs a CUSIP with a ticker, because registered funds report
  both. Reads the ZIP central directory from a byte range and pulls only the two
  members it needs, so a 440 MB archive costs neither the download nor the
  memory.
- **Added** `extraction/cusipTickerCrosswalk` — folds N-PORT's identifier rows
  per holding and cross-checks each CUSIP against the ISIN that contains it.
- **Added** `sources/openFigiClient` — OpenFIGI mapping for CUSIPs no fund
  holds. Do NOT pin `exchCode: "US"`: a delisted security has no US venue row,
  so it silently returns nothing for exactly the names that need resolving.
- **Added** `extraction/resolveHoldingTickers` — stamps `resolvedTicker` onto a
  parsed dataset from any pair source, so the package does the whole job rather
  than handing out the pieces.
- **Added** `SecHttp.getRange`, optional, for archives too large to hold whole.
- **Added** `examples/resolve-tickers.ts`, compiled by `npm run typecheck:examples`.

### `valueUnitSource` makes uncertainty explicit

Which evidence decided a row's unit, strongest first:

| value | evidence |
|---|---|
| `price` | the security's actual close on the period-end date |
| `median` | the filing's own median implied price |
| `date` | SEC's rule alone, which filers break in both directions |
| `unknown` | undetermined — do not trust this row's dollar value |

`normalizeThirteenFValuesToDollars` sets `median`, `date` and `unknown`. The
package ships no price history, so `price` is for a consumer that holds one to
write after the fact — and it must look the price up on **`periodOfReport`**,
not `filingDate`: a 13F values its holdings as of the period end and is filed
30-45 days later.


## 0.2.0

### The 13F `value` column changes units mid-history

SEC's 2022 Form 13F amendments switched the information table from reporting
value in **thousands of USD** to **whole USD**, for filings from 2023-01-01. The
column carries no unit, so `SUM(value)` across the full history adds the two
together and inflates everything from 2023 onward by 1000x against everything
before it.

Measured as median implied price per share (`value / sharesAmount`, SH rows, no
option leg), which is only plausible under one convention at a time:

```
filing month   under dollars   under thousands
2022-11              0.0478            47.80
2022-12              0.0773            77.30
2023-01             36.9710         36971.00
```

The cutover keys on **`filingDate`, not `periodOfReport`** — Q4-2022 holdings
were filed in January and February 2023 under the new rule, so a period-keyed
split mis-scales an entire quarter.

- **Added** `normalizeThirteenFValuesToDollars(rows)` and
  `reportsValueInThousands(filingDate)`. Parsed rows still carry the filed
  number; this converts a dataset to one comparable unit when a consumer needs
  it. It is deliberately **not idempotent** — a second pass scales by a million
  — so it runs once per parse of a raw archive, never against rows read back
  from a published table.
- **Fixed** the docs, which asserted `value` was "in thousands of USD" without
  qualification. That claim was true only before 2023 and is what the error
  propagated from.
- **Fixed** the FIGI claim: it is not "~4% filled", it is **empty before 2024**
  and only appears after the 2023 amendments made it an optional column. Those
  are different facts for anyone planning to join on it.


All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-23

First public release.

### Added

- **Insider Form 3/4/5 extraction** from the official SEC quarterly data sets,
  2006Q1 onward: `insider_filings` (one row per filing × reporting owner) and
  `insider_transactions` (one row per non-derivative or derivative leg).
- **Institutional 13F extraction**, 2013Q2 onward: `institutional_filings` and
  `institutional_holdings`, parsing both the classic `{YYYY}q{N}` archives and
  the newer acceptance-window archives whose TSVs nest under a varying
  directory.
- **Point-in-time availability** on every row (`availableAt`), taken from the
  filing date rather than the transaction date or period of report.
- **Resumable, shardable backfill** (`sec-backfill`): content-addressed raw
  archives, a receipt per window, and hash-based sharding so the shard count can
  change between runs without reprocessing.
- **Integrity audit** (`sec-integrity`): re-parses the archived ZIPs rather than
  trusting the backfill's counters, and checks grain uniqueness, orphan joins,
  boundary disjointness, NT-with-holdings, placeholder shapes and code
  inventories. A partial audit fails instead of being published.
- **Filing-lag report** (`sec-lags`): period-to-filing distributions split by
  original and amendment, read from SUBMISSION tables alone.
- **Storage and transport ports** with filesystem and S3-compatible adapters,
  so the extraction layer never knows where bytes come from.

### Known limits

Measured rather than estimated, with the numbers in
[METHODOLOGY.md](./METHODOLOGY.md): FIGI is 3.7% filled (CUSIP→ticker mapping is
not built yet), 13F remains long-only and 45-day lagged, and anomaly classes
(zero positions, NT filings carrying holdings, transactions dated after their
filing) are preserved and flagged rather than dropped.

[0.1.0]: https://github.com/austin-starks/sec-ownership-disclosures/releases/tag/v0.1.0
