export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    isRetryable: () => true,
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff.
 * Delays: baseDelayMs, baseDelayMs*2, baseDelayMs*4, ...
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts?: RetryOptions
): Promise<T> {
    const { maxAttempts, baseDelayMs, isRetryable } = { ...DEFAULT_OPTIONS, ...opts };

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts || !isRetryable(error)) {
                throw error;
            }
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            process.stderr.write(
                `[retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms\n`
            );
            await sleep(delay);
        }
    }
    throw lastError; // unreachable, but satisfies TS
}
