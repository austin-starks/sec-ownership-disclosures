# Methodology: SEC ownership disclosures lake

How the insider (Form 3/4/5) and institutional (13F) tables are built, what
each row means, and what the audit measured. Written from the shipped code
after validation — numbers below are measured, not estimated.

## Sources (all official SEC EDGAR)

- Insider: quarterly Form 3/4/5 data sets, 2006Q1–2026Q2, from **two** paths.
  SEC moved this publication from `/files/structureddata/` to
  `/files/datastandardsinnovation/` starting at 2026Q2 and left every earlier
  quarter on the old path, so neither is a superset and **a 404 on one path is
  not a stop signal**. This file previously recorded "2026Q2 unpublished at last
  pass; walk-forward 404 is the stop signal" — that inference was wrong, SEC's
  landing page linked 2026Q2 the whole time, and the lake was missing April
  through August 2026 because of it. Plus the EDGAR daily form index + per-filing XML for
  freshness (not yet backfilled — quarterly sets lag up to a quarter).
- Institutional: quarterly Form 13F data sets, 2013Q2–present, 54 windows.
  Two naming eras coexist: classic `{YYYY}q{N}_form13f.zip` and
  acceptance-window `{01mar2026-31may2026}_form13f.zip`; recent windows nest
  TSVs under a `{STEM}/` directory. Both eras parsed; prefix detected, never
  assumed.

## Grain and identity

- `insider_filings`: one row per filing × reporting owner (joint filings
  produce one row per owner; count filings with `COUNT(DISTINCT accession)`).
- `insider_transactions`: one row per non-derivative/derivative leg,
  keyed by accession + row SK. 10,045,180 rows across 4,839,497 filings.
- `institutional_filings`: one row per 13F submission (HR, HR/A, NT, NT/A).
- `institutional_holdings`: one row per information-table leg, keyed by
  accession + INFOTABLE_SK. 124,012,468 rows across 409,685 filings.
- Names are labels, never keys: issuer/owner/manager names may be blank
  (measured: Trupanion 2020 filing with blank names but valid CIKs). Joins
  run on CIK / accession / CUSIP.

## Amendments are versions, originals are never overwritten

Each amendment (4/A, 13F-HR/A) is its own row with its own `availableAt`.
Measured: 575 Form 4/A + amendments across insider; 15,727 HR/A + 756 NT/A
across 13F. Amendment lag (filed minus period): p50 115d, p95 1,121d —
amendments run late by nature.

## Point-in-time

Availability is `availableAt`: filing-date EOD America/New_York for quarterly
sets (acceptance + 1 min for daily XML when that path lands). Never the
transaction date, never the report period. 13F originals file at p50 42d /
p95 48d after period-end — the 45-day rule, measured over 393,202 originals
(max 12,831d outlier). A February 13F about December holdings belongs to
February: it measures holdings with lag, never entry timing.

## What "buy" means (insider)

`transactionCode = 'P'` (open market purchase) is discretionary buying:
894,244 rows. Grants (A, 2.48M), exercises (M, 1.96M), sales (S, 2.60M) and
ten other codes are not buys. Full code inventory ships in the integrity
report; unknown codes surface there, never silently.

## Known limits (measured)

- 13F is long-only, 45-day-lagged, manager-aggregated; 5.4% of rows are
  put/call options, the rest long stock. 914,313 zero-position rows (0.7%,
  incl. 6,824 placeholder-CUSIP `000000000`) are preserved, not dropped.
- 11 13F-NT notice filings carry holdings (of 86,730 NT) — anomaly class,
  kept verbatim.
- 2,870 insider transactions are dated after their filing date (0.03%);
  8,187 have null shares; 15 rows have no transaction code. Kept, flagged.
- **FIGI is empty before 2024**, not thinly spread. Per-year fill measured on
  the published table is `0.000000000000` for 2013–2023; the 24,004 CUSIPs
  carrying one are 2024+, after the 2023 amendments made it an optional column.
  An aggregate "3.7% overall" hid that shape. CUSIP→ticker mapping is the
  remaining workload, not yet built.
- Insider `issuerTicker` is free text typed by the filer: 0.8% of 2026 and
  1.6% of 2015 transactions are not ticker-shaped. `resolvedTicker` reduces it
  to one symbol from the row's own text (first class of a list, null when no
  symbol is named); `issuerTicker` stays verbatim.
- 13F value is as-reported in thousands of USD (FORM13F readme); shares are
  as-reported counts.
- Classic quarters and acceptance windows are disjoint accession sets
  (verified: 409,685 distinct of 409,685) — sequential eras, no dedupe debt.

## Audit trail

Every quarter parsed from content-addressed raw ZIPs in Tigris
(`sec-ownership/raw/...`), receipts per quarter, idempotent resume (second
run processes nothing). Integrity reports:
`reports/backfill-2026-09-22-form345/integrity-form345.json`,
`reports/backfill-2026-09-22-form13f/integrity-form13f.json`,
`reports/backfill-2026-09-22-form13f/filing-lags.json`. Checks: grain
uniqueness, orphan joins (0/0), boundary disjointness (Form345 quarters),
NT-with-holdings, placeholder shapes, code/type inventories, lag
distributions. The runner fails a partial audit instead of publishing it
(43 windows once passed as 11 through a label-regex miss — now guarded by
receipt coverage).
