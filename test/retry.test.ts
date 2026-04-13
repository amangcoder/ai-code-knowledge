import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../scripts/lib/retry.js';

describe('withRetry', () => {
    it('returns result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds eventually', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail1'))
            .mockRejectedValueOnce(new Error('fail2'))
            .mockResolvedValue('ok');

        const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting max attempts', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('always fails'));

        await expect(
            withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
        ).rejects.toThrow('always fails');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-retryable errors', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('auth error'));

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 1,
                isRetryable: () => false,
            })
        ).rejects.toThrow('auth error');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('uses custom isRetryable predicate', async () => {
        const retryableError = new Error('timeout');
        (retryableError as any).retryable = true;
        const nonRetryableError = new Error('bad input');

        const fn = vi.fn()
            .mockRejectedValueOnce(retryableError)
            .mockRejectedValueOnce(nonRetryableError);

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 1,
                isRetryable: (err: unknown) => (err as any).retryable === true,
            })
        ).rejects.toThrow('bad input');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('applies exponential backoff delays', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail1'))
            .mockRejectedValueOnce(new Error('fail2'))
            .mockResolvedValue('ok');

        const start = Date.now();
        await withRetry(fn, { maxAttempts: 3, baseDelayMs: 50 });
        const elapsed = Date.now() - start;

        // First retry: 50ms, second retry: 100ms = 150ms total minimum
        expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('defaults to 3 attempts', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));
        await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(3);
    });
});
