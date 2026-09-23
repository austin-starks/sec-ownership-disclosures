import {
  fetchForm345Dataset,
  fetchForm345DatasetZip,
  form345DatasetUrl,
  form345DatasetUrls,
} from "./form345Datasets";
import type { SecHttp } from "./http";

const LEGACY = "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets";
const CURRENT =
  "https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets";

describe("form345DatasetUrls", () => {
  it("knows both locations SEC publishes from", () => {
    expect(form345DatasetUrls(2026, 2)).toEqual([
      `${LEGACY}/2026q2_form345.zip`,
      `${CURRENT}/2026q2_form345.zip`,
    ]);
  });

  it("leads with the legacy path, where eighty-odd quarters still live", () => {
    expect(form345DatasetUrl(2006, 1)).toBe(`${LEGACY}/2006q1_form345.zip`);
    expect(form345DatasetUrl(2025, 4)).toBe(`${LEGACY}/2025q4_form345.zip`);
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

describe("fetchForm345Dataset", () => {
  it("returns the ZIP when the legacy path serves it, without a second request", async () => {
    const asked: string[] = [];
    const http: SecHttp = {
      get: async (url: string) => {
        asked.push(url);
        return Buffer.from("zip");
      },
    };

    await expect(fetchForm345Dataset(http, 2025, 4)).resolves.toEqual({
      zip: Buffer.from("zip"),
      url: `${LEGACY}/2025q4_form345.zip`,
    });
    expect(asked).toHaveLength(1);
  });

  it("follows a 404 to the newer path and says where the bytes came from", async () => {
    // SEC moved this publication at 2026q2 and left earlier quarters behind.
    // Believing the first 404 is what stopped lakes at 2026q1.
    const http = httpWith(new Map([[`${LEGACY}/2026q2_form345.zip`, 404]]));

    await expect(fetchForm345Dataset(http, 2026, 2)).resolves.toEqual({
      zip: Buffer.from("zip"),
      url: `${CURRENT}/2026q2_form345.zip`,
    });
  });

  it("returns null only when EVERY known path 404s", async () => {
    const http = httpWith(
      new Map([
        [`${LEGACY}/2026q3_form345.zip`, 404],
        [`${CURRENT}/2026q3_form345.zip`, 404],
      ])
    );

    await expect(fetchForm345Dataset(http, 2026, 3)).resolves.toBeNull();
  });

  it("rethrows a weekday 403 instead of hiding an egress block", async () => {
    const http = httpWith(new Map([[`${LEGACY}/2025q4_form345.zip`, 403]]));
    await expect(fetchForm345Dataset(http, 2025, 4)).rejects.toThrow("403");
  });
});

describe("fetchForm345DatasetZip", () => {
  it("keeps returning the bytes alone for existing callers", async () => {
    const http = httpWith(new Map([[`${LEGACY}/2026q2_form345.zip`, 404]]));
    await expect(fetchForm345DatasetZip(http, 2026, 2)).resolves.toEqual(Buffer.from("zip"));
  });

  it("is null when the quarter is genuinely unpublished", async () => {
    const http = httpWith(
      new Map([
        [`${LEGACY}/2026q3_form345.zip`, 404],
        [`${CURRENT}/2026q3_form345.zip`, 404],
      ])
    );
    await expect(fetchForm345DatasetZip(http, 2026, 3)).resolves.toBeNull();
  });
});
