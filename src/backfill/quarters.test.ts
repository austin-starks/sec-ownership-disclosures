import {
  discoverThirteenFWindows,
  form345QuarterIdentities,
  thirteenFQuarterIdentities,
} from "./quarters";

describe("form345QuarterIdentities", () => {
  it("walks quarters across a year boundary", () => {
    expect(
      form345QuarterIdentities({ year: 2025, quarter: 3 }, { year: 2026, quarter: 2 }).map((q) => q.identity)
    ).toEqual(["form345:2025q3", "form345:2025q4", "form345:2026q1", "form345:2026q2"]);
  });

  it("rejects a backwards range", () => {
    expect(() => form345QuarterIdentities({ year: 2026, quarter: 2 }, { year: 2025, quarter: 3 })).toThrow(
      "runs backwards"
    );
  });
});

describe("thirteenFQuarterIdentities", () => {
  it("labels the classic era", () => {
    const quarters = thirteenFQuarterIdentities({ year: 2013, quarter: 2 }, { year: 2013, quarter: 4 });
    expect(quarters.map((q) => q.label)).toEqual(["2013q2", "2013q3", "2013q4"]);
    expect(quarters[0]?.dataset).toBe("form13f");
  });
});

describe("discoverThirteenFWindows", () => {
  it("reads both naming eras and ignores everything else", () => {
    const html = [
      '<a href="/files/structureddata/data/form-13f-data-sets/2013q2_form13f.zip" download>2013 Q2</a>',
      '<a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">window</a>',
      '<a href="/files/structureddata/data/form-13f-data-sets/2013q2_form13f.zip">dup</a>',
      '<a href="/files/form_13f_readme.pdf">readme</a>',
      '<a href="/files/structureddata/data/form-13f-data-sets/../other.zip">traversal</a>',
    ].join("\n");
    expect(discoverThirteenFWindows(html)).toEqual(["01mar2026-31may2026_form13f", "2013q2_form13f"]);
  });

  it("parses the live index page shape", () => {
    const html = '<a href="/files/datastandardsinnovation/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip">x</a>';
    expect(discoverThirteenFWindows(html)).toEqual(["01jun2026-31aug2026_form13f"]);
  });
});
