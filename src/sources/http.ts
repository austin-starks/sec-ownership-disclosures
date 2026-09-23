/**
 * The single HTTP boundary for all EDGAR access. Library modules never touch
 * the network directly: the host application injects pacing, User-Agent,
 * retry, and credentials here. One method on purpose — resist adding a second
 * for a caller that does not exist yet.
 */
export interface SecHttp {
  get(url: string): Promise<Buffer>;
  /**
   * A byte range, plus the archive's total size from `content-range`.
   *
   * Added for the N-PORT data sets, which are ~440 MB ZIPs holding 32 members
   * of which the CUSIP-to-ticker crosswalk needs two. Reading the central
   * directory from the tail and then only those members is the difference
   * between 367 MB and 440 MB per quarter, and between holding an archive in
   * memory and not.
   *
   * Optional so existing hosts keep working; callers that need it say so.
   */
  getRange?(url: string, range: string): Promise<{ body: Buffer; totalBytes: number }>;
}

/** Narrow a host's http to one that can do ranges, with a message that says what to add. */
export function requireRangeSupport(
  http: SecHttp,
  forWhat: string,
): Required<Pick<SecHttp, "getRange">> & SecHttp {
  if (typeof http.getRange !== "function") {
    throw new Error(
      `${forWhat} needs SecHttp.getRange(url, range). Implement it with a Range header, ` +
        `returning the body and the total size parsed from the content-range response header.`,
    );
  }
  return http as Required<Pick<SecHttp, "getRange">> & SecHttp;
}
