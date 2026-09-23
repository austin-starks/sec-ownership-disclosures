import {
  edgarArchiveUrl,
  edgarDailyFormIndexUrl,
  fetchEdgarDailyFormIndex,
  isWeekendEdgarIndexDate,
} from "./edgarDaily";
import type { SecHttp } from "./http";

describe("edgarDailyFormIndexUrl", () => {
  it("builds the verified daily index URL", () => {
    expect(edgarDailyFormIndexUrl("2026-09-11")).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260911.idx"
    );
  });

  it("rejects a non-date", () => {
    expect(() => edgarDailyFormIndexUrl("20260911")).toThrow("YYYY-MM-DD");
  });
});

describe("isWeekendEdgarIndexDate", () => {
  it("skips Saturday and Sunday before HTTP", () => {
    expect(isWeekendEdgarIndexDate("2026-09-19")).toBe(true);
    expect(isWeekendEdgarIndexDate("2026-09-20")).toBe(true);
    expect(isWeekendEdgarIndexDate("2026-09-22")).toBe(false);
  });
});

describe("edgarArchiveUrl", () => {
  it("strips leading slashes", () => {
    expect(edgarArchiveUrl("/edgar/data/1/2.txt")).toBe("https://www.sec.gov/Archives/edgar/data/1/2.txt");
    expect(edgarArchiveUrl("edgar/data/1/2.txt")).toBe("https://www.sec.gov/Archives/edgar/data/1/2.txt");
  });
});

describe("fetchEdgarDailyFormIndex", () => {
  it("returns null on weekends without touching HTTP", async () => {
    const http: SecHttp = {
      get: async () => {
        throw new Error("must not fetch on weekends");
      },
    };
    await expect(fetchEdgarDailyFormIndex(http, "2026-09-19")).resolves.toBeNull();
  });

  it("returns null on 404 and rethrows a weekday 403", async () => {
    const notFound: SecHttp = {
      get: async () => {
        throw Object.assign(new Error("GET -> 404"), { status: 404 });
      },
    };
    await expect(fetchEdgarDailyFormIndex(notFound, "2026-09-22")).resolves.toBeNull();

    const denied: SecHttp = {
      get: async () => {
        throw Object.assign(new Error("GET -> 403"), { status: 403 });
      },
    };
    await expect(fetchEdgarDailyFormIndex(denied, "2026-09-22")).rejects.toThrow("403");
  });
});
