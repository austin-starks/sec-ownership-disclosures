import { promises as fs } from "fs";
import { createHash } from "crypto";
import { join } from "path";

import type { DataStore, PutOptions, StoredObject } from "../ports";

/**
 * A `DataStore` on the local filesystem, for dry runs, tests, and laptop
 * proofs. Keys map to paths under `root` (rejecting escapes); production
 * rounds use the S3-compatible store server-side. Receipt semantics are
 * identical, so a round proven here behaves the same there.
 */
export class FileDataStore implements DataStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private pathFor(key: string): string {
    if (key.startsWith("/") || key.includes("..")) {
      throw new Error(`refusing escaped key ${JSON.stringify(key)}`);
    }
    return join(this.root, key);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (error) {
      throw new Error(`missing ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async put(key: string, body: Buffer, _options?: PutOptions): Promise<void> {
    const path = this.pathFor(key);
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, body);
  }

  async putIfAbsent(key: string, body: Buffer, options?: PutOptions): Promise<boolean> {
    if (await this.exists(key)) {
      const current = await this.get(key);
      if (createHash("sha256").update(current).digest("hex") !== createHash("sha256").update(body).digest("hex")) {
        throw new Error(`conflicting body for ${key}`);
      }
      return false;
    }
    await this.put(key, body, options);
    return true;
  }

  async list(prefix: string, limit?: number): Promise<StoredObject[]> {
    const found: StoredObject[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (limit !== undefined && found.length >= limit) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), entryRel);
        } else if (entryRel.startsWith(prefix)) {
          const stat = await fs.stat(join(dir, entry.name));
          found.push({ key: entryRel, size: stat.size, lastModified: stat.mtime });
        }
        if (limit !== undefined && found.length >= limit) return;
      }
    };
    try {
      await walk(this.root, "");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
    return found;
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const stat = await fs.stat(this.pathFor(key));
      return { key, size: stat.size, lastModified: stat.mtime };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}
