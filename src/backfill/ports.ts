/**
 * The ports a backfill runs against. Every one is an interface, so the pipeline
 * never names a vendor: Tigris, R2 and MinIO are the same `DataStore` with a
 * different endpoint, and a filesystem implementation is equally valid.
 *
 * Deliberately narrower than the congressional template: SEC sources are free
 * structured downloads, so there is no paid work to collapse and no
 * single-flight lease, no model port, no OCR port. Table publishing stays
 * server-side until the cutover; when it moves, a `TableWriter` port joins
 * this file. Nothing here is added for a caller that does not exist yet.
 */

/** An object in a `DataStore`, as a listing reports it. */
export interface StoredObject {
  key: string;
  size: number;
  lastModified?: Date;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

/**
 * Content-addressed blob storage.
 *
 * `putIfAbsent` is what makes a round idempotent: bodies are keyed by their own
 * digest, so a re-run writes the same key and the store reports that it already
 * existed rather than paying to store it twice.
 */
export interface DataStore {
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, options?: PutOptions): Promise<void>;
  /** True when this call created the object, false when an identical one was already there. */
  putIfAbsent(key: string, body: Buffer, options?: PutOptions): Promise<boolean>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  /** Needed for repair: dropping a receipt is how a round is told to redo an item. */
  delete(key: string): Promise<void>;
}
