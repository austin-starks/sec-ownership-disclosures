import { fetchForm345DatasetZip, form345DatasetUrl } from "./form345Datasets";
import type { SecHttp } from "./http";

describe("form345DatasetUrl", () => {
  it("builds the verified quarterly URL", () => {
    expect(form345DatasetUrl(2025, 4)).toBe(
      "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2025q4_form345.zip"
    );
    expect(form345DatasetUrl(2006, 1)).toBe(
      "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2006q1_form345.zip"
    );
  });
});

function httpWith(statusByUrl: Map<string, number>, body = Buffer.from("zip")): SecHttp {
  return {
    get: async (url: string): Promise<Buffer> => {
      const status = statusByUrl.get(url) ?? 200;
      if (status !== 200) throw Object.assign(new Error(`GET ${url} -> ${status}`), { status });
      return body;
    },
  };
}

describe("fetchForm345DatasetZip", () => {
  it("returns the ZIP when SEC serves it", async () => {
    const http = httpWith(new Map());
    await expect(fetchForm345DatasetZip(http, 2025, 4)).resolves.toEqual(Buffer.from("zip"));
  });

  it("returns null on 404 (unpublished quarter)", async () => {
    const http = httpWith(new Map([[form345DatasetUrl(2026, 2), 404]]));
    await expect(fetchForm345DatasetZip(http, 2026, 2)).resolves.toBeNull();
  });

  it("rethrows a weekday 403 instead of hiding an egress block", async () => {
    const http = httpWith(new Map([[form345DatasetUrl(2025, 4), 403]]));
    await expect(fetchForm345DatasetZip(http, 2025, 4)).rejects.toThrow("403");
  });
});
