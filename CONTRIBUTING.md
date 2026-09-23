# Contributing

Issues and focused pull requests are welcome. Start with a concrete filing,
command, or number that is wrong. A parser rewrite without a failing fixture is
hard to review and easy to overfit.

## I found a defect

Include:

- the installed package version;
- the exact command or smallest code sample that reproduces it;
- the accession number or archive URL when one filing triggers it;
- the expected result and the actual named failure;
- your Node and operating-system versions.

Do not paste credentials or paid-provider responses.

If you want to fix it yourself, add a fixture that fails first. A useful pull
request shows the failing test, the smallest fix, and a passing `npm test`. It
does not need a broad refactor.

## What this package will and will not do

It parses official SEC archives into rows and keeps every anomaly it finds.
Three rules govern what belongs here:

- **Availability is never inferred.** A row's `availableAt` comes from the
  filing date. A change that derives availability from a transaction date or a
  period of report will be declined, because it makes the data unusable for
  research without saying so.
- **Anomalies are preserved and flagged, not dropped.** Zero-position holdings,
  notice filings carrying holdings, and transactions dated after their filing
  are real features of the source. Filtering them makes a cleaner table and a
  less honest one.
- **Names are labels, never keys.** Joins are by CIK, accession and CUSIP.
  Official filings do carry blank names, and code that keys on a name will
  quietly lose those rows.

## Adding a storage or transport adapter

Storage and HTTP are ports. A filesystem adapter and an S3-compatible adapter
ship with the package, and `SecHttp` lets a caller supply its own client for
rate limiting, caching or a proxy.

Open an issue before building a new adapter. Name the problem it solves, the
interface it implements, and a stubbed offline test. Adapters must stay
optional: installing the package cannot require anyone's credentials.

## Set up the repository

```bash
npm install
npm run build
npm test          # 68 tests, 20 suites, all offline
npm run verify:release
```

Every test runs against committed fixtures. Nothing in the suite reaches the
network, so it works on a plane and fails for real reasons.

## License

By contributing you agree that your contributions are licensed under the MIT
License in [LICENSE](./LICENSE).
