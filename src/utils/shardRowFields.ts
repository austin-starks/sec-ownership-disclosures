/**
 * Field readers for rows read back from lake shards (`services/lake/yearShardRows.ts`),
 * where every value has already been converted by its declared column type. Each
 * reader checks the value against the row interface and throws with the table and
 * field on a mismatch, so a corrupt or drifted shard stops a merge instead of being
 * republished.
 */
export class ShardRowReader {
  constructor(private readonly table: string, private readonly raw: Record<string, unknown>) {}

  private fail(field: string): never {
    throw new Error(`${this.table} row has an unexpected ${field}: ${JSON.stringify(this.raw[field])}`);
  }

  text(field: string): string {
    const value = this.raw[field];
    return typeof value === "string" ? value : this.fail(field);
  }

  textOrNull(field: string): string | null {
    return this.raw[field] === null ? null : this.text(field);
  }

  number(field: string): number {
    const value = this.raw[field];
    return typeof value === "number" && Number.isFinite(value) ? value : this.fail(field);
  }

  numberOrNull(field: string): number | null {
    return this.raw[field] === null ? null : this.number(field);
  }

  boolean(field: string): boolean {
    const value = this.raw[field];
    return typeof value === "boolean" ? value : this.fail(field);
  }

  booleanOrNull(field: string): boolean | null {
    return this.raw[field] === null ? null : this.boolean(field);
  }

  date(field: string): Date {
    const value = this.raw[field];
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : this.fail(field);
  }

  dateOrNull(field: string): Date | null {
    return this.raw[field] === null ? null : this.date(field);
  }

  oneOf<T extends string>(field: string, allowed: readonly T[]): T {
    const value = this.raw[field];
    const match = allowed.find((candidate) => candidate === value);
    return match ?? this.fail(field);
  }
}
