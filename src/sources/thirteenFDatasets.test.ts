import {
  fetchThirteenFDatasetZip,
  thirteenFQuarterFilename,
  thirteenFQuarterUrls,
  thirteenFWindowUrls,
} from "./thirteenFDatasets";
import type { SecHttp } from "./http";

describe("thirteenFQuarterFilename", () => {
  it("builds the classic quarterly filename", () => {
    expect(thirteenFQuarterFilename(2013, 2)).toBe("2013q2_form13f.zip");
    expect(thirteenFQuarterFilename(2026, 4)).toBe("2026q4_form13f.zip");
  });
});

describe("thirteenFQuarterUrls", () => {
  it("offers both base paths, preferred base first", () => {
    expect(thirteenFQuarterUrls(2013, 2)).toEqual([
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2013q2_form13f.zip",
      "https://www.sec.gov/files/datastandardsinnovation/data/form-13f-data-sets/2013q2_form13f.zip",
    ]);
  });
});

describe("thirteenFWindowUrls", () => {
  it("builds acceptance-window candidates under both bases", () => {
    expect(thirteenFWindowUrls("01mar2026-31may2026_form13f")).toEqual([
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
      "https://www.sec.gov/files/datastandardsinnovation/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
    ]);
  });

  it("rejects a label it cannot have produced", () => {
    expect(() => thirteenFWindowUrls("2026q1")).toThrow("01mar2026-31may2026_form13f");
  });
});

function httpWith(responses: Map<string, Buffer | { status: number }>): SecHttp {
  return {
    get: async (url: string): Promise<Buffer> => {
      const response = responses.get(url);
      if (response === undefined) throw Object.assign(new Error(`GET ${url} -> 404`), { status: 404 });
      if ("status" in response) {
        throw Object.assign(new Error(`GET ${url} -> ${response.status}`), { status: response.status });
      }
      return response;
    },
  };
}

describe("fetchThirteenFDatasetZip", () => {
  it("takes the first base that serves the file", async () => {
    const urls = thirteenFQuarterUrls(2013, 2);
    const first = urls[0];
    if (!first) throw new Error("expected a candidate URL");
    const http = httpWith(new Map([[first, Buffer.from("zip")]]));
    await expect(fetchThirteenFDatasetZip(http, urls)).resolves.toEqual(Buffer.from("zip"));
  });

  it("returns null when every candidate 404s", async () => {
    const http = httpWith(new Map());
    await expect(fetchThirteenFDatasetZip(http, thirteenFQuarterUrls(2050, 1))).resolves.toBeNull();
  });

  it("rethrows a non-404 failure instead of hiding it", async () => {
    const urls = thirteenFQuarterUrls(2013, 2);
    const first = urls[0];
    if (!first) throw new Error("expected a candidate URL");
    const http = httpWith(new Map([[first, { status: 500 }]]));
    await expect(fetchThirteenFDatasetZip(http, urls)).rejects.toThrow("500");
  });

  it("needs at least one candidate URL", async () => {
    const http = httpWith(new Map());
    await expect(fetchThirteenFDatasetZip(http, [])).rejects.toThrow("at least one candidate URL");
  });
});
