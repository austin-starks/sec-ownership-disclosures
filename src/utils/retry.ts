export class RetryError extends Error {
  errors: Error[];
  public override readonly name = "RetryError";

  constructor(message: string, errors: Error[]) {
    super(message);
    this.errors = errors;
  }

  public override toString(): string {
    return `${this.message}\n${this.errors
      .map((error) => error.toString())
      .join("\n")}`;
  }
}

/**
 * Flatten an error to one line that keeps the cause.
 *
 * `RetryError.message` is only "Request failed after N retries." The final
 * transport reason lives in `errors`, so alert paths use this helper instead
 * of dropping the actionable failure.
 */
export function describeError(error: unknown): string {
  if (error instanceof RetryError && error.errors.length > 0) {
    const last = error.errors[error.errors.length - 1];
    if (!last) return error.message;
    return `${error.message} last: ${last.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxJitterMs?: number;
  /** Rethrow terminal failures without wrapping or retrying them. */
  isNonRetryable?: (error: unknown) => boolean;
}

export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxJitterMs = 500,
    isNonRetryable,
  } = options;

  let retries = 0;
  const errors: Error[] = [];
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (isNonRetryable?.(error)) throw error;
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      console.error(normalized.message);
      errors.push(normalized);
      retries++;
      if (retries >= maxRetries) {
        throw new RetryError(
          `Request failed after ${maxRetries} retries.`,
          errors
        );
      }

      const jitter = Math.floor(Math.random() * maxJitterMs);
      const delayMs = baseDelayMs * Math.pow(2, retries - 1) + jitter;
      console.log(`Request failed. Retrying in ${delayMs}ms...`);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Request failed after ${maxRetries} retries.`);
}
