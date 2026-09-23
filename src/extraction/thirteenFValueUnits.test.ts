import type { ThirteenFDatasetRows } from "./infoTable";

import {
  THIRTEEN_F_DOLLARS_FROM,
  normalizeThirteenFValuesToDollars,
  reportsValueInThousands,
} from "./thirteenFValueUnits";

function filing(accession: string, filingDate: string) {
  return {
    accession,
    filingDate,
    availableAt: new Date(`${filingDate}T23:59:59.999Z`),
    availabilitySource: "test",
    submissionType: "13F-HR",
    cik: "0000000001",
    managerName: "Test Manager",
    periodOfReport: null,
    reportCalendarOrQuarter: null,
    isAmendment: null,
    amendmentNo: null,
    amendmentType: null,
    dateReported: null,
    rawArchiveKey: "test",
  };
}

function holding(accession: string, value: number | null) {
  return {
    accession,
    infoTableSk: `${accession}-1`,
    availableAt: new Date("2023-01-01T00:00:00.000Z"),
    availabilitySource: "test",
    issuerName: "Test Issuer",
    titleOfClass: "COM",
    cusip: "037833100",
    figi: null,
    value,
    sharesAmount: 100,
    sharesType: "SH",
    putCall: null,
    discretion: null,
    otherManager: null,
    votingSole: null,
    votingShared: null,
    votingNone: null,
    rawArchiveKey: "test",
  };
}

function dataset(
  filings: ReturnType<typeof filing>[],
  holdings: ReturnType<typeof holding>[],
): ThirteenFDatasetRows {
  return { filings, holdings } as unknown as ThirteenFDatasetRows;
}

describe("reportsValueInThousands", () => {
  it("splits on the filing date SEC's amendments took effect", () => {
    expect(THIRTEEN_F_DOLLARS_FROM).toBe("2023-01-01");
    expect(reportsValueInThousands("2022-12-31")).toBe(true);
    expect(reportsValueInThousands("2023-01-01")).toBe(false);
    expect(reportsValueInThousands("2023-02-14")).toBe(false);
  });

  it("is false for a missing date rather than defaulting to scaling", () => {
    // Defaulting to "thousands" would multiply an unknown row by 1000.
    expect(reportsValueInThousands(null)).toBe(false);
    expect(reportsValueInThousands(undefined)).toBe(false);
    expect(reportsValueInThousands("")).toBe(false);
  });
});

describe("normalizeThirteenFValuesToDollars", () => {
  it("scales a pre-2023 filing to dollars and leaves a 2023 filing alone", () => {
    const rows = dataset(
      [filing("A", "2022-11-14"), filing("B", "2023-02-14")],
      [holding("A", 1_234), holding("B", 1_234_000)],
    );

    const report = normalizeThirteenFValuesToDollars(rows);

    expect(rows.holdings[0]!.value).toBe(1_234_000);
    expect(rows.holdings[1]!.value).toBe(1_234_000);
    expect(report).toEqual({ scaled: 1, untouched: 1, unresolvedFilingDate: 0 });
  });

  it("keys on the FILING date, so Q4-2022 holdings filed in 2023 stay in dollars", () => {
    // The trap: periodOfReport is 2022-12-31 but the filing landed in February
    // 2023 under the new rule. Keying on the period would inflate it 1000x.
    const rows = dataset([filing("A", "2023-02-10")], [holding("A", 5_000_000)]);

    normalizeThirteenFValuesToDollars(rows);

    expect(rows.holdings[0]!.value).toBe(5_000_000);
  });

  it("leaves a holding whose filing is absent unscaled, and counts it", () => {
    const rows = dataset([], [holding("ORPHAN", 42)]);

    const report = normalizeThirteenFValuesToDollars(rows);

    expect(rows.holdings[0]!.value).toBe(42);
    expect(report.unresolvedFilingDate).toBe(1);
    expect(report.scaled).toBe(0);
  });

  it("ignores a null value instead of turning it into zero", () => {
    const rows = dataset([filing("A", "2020-05-15")], [holding("A", null)]);

    const report = normalizeThirteenFValuesToDollars(rows);

    expect(rows.holdings[0]!.value).toBeNull();
    expect(report.scaled).toBe(0);
    expect(report.untouched).toBe(0);
  });

  it("scales by exactly 1000, which a second pass would compound to a million", () => {
    // Guarding the property that makes this function single-use: the publish
    // path must never run it against rows read back from a published shard.
    const rows = dataset([filing("A", "2019-08-14")], [holding("A", 7)]);

    normalizeThirteenFValuesToDollars(rows);
    expect(rows.holdings[0]!.value).toBe(7_000);

    normalizeThirteenFValuesToDollars(rows);
    expect(rows.holdings[0]!.value).toBe(7_000_000);
  });
});
