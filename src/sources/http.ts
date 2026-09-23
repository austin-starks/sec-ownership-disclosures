/**
 * The single HTTP boundary for all EDGAR access. Library modules never touch
 * the network directly: the host application injects pacing, User-Agent,
 * retry, and credentials here. One method on purpose — resist adding a second
 * for a caller that does not exist yet.
 */
export interface SecHttp {
  get(url: string): Promise<Buffer>;
}
