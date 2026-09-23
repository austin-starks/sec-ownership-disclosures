import type { SecHttp } from "../sources/http";

/**
 * Concrete SecHttp over Node's global fetch: the CLI/runtime boundary that
 * owns pacing, User-Agent, and retry. Library modules never touch this; the
 * host application injects it. HTTP errors throw with a numeric `status`
 * property so fetchers can treat 404 as "not published" without importing an
 * HTTP client type into the library.
 */
export function nodeFetchHttp(options: { userAgent: string; timeoutMs?: number }): SecHttp {
  const timeoutMs = options.timeoutMs ?? 300_000;
  return {
    get: async (url: string): Promise<Buffer> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": options.userAgent },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw Object.assign(new Error(`GET ${url} -> ${response.status}`), {
            status: response.status,
          });
        }
        return Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
