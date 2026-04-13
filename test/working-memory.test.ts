/**
 * Unit tests for WorkingMemory (mcp-server/tools/lib/working-memory.ts).
 *
 * Covers:
 *   - Cache miss (key absent)
 *   - Cache hit with structuredClone protection
 *   - TTL expiry via vi.useFakeTimers()
 *   - buildTimestamp invalidation
 *   - LRU eviction at capacity 50
 *   - hit/miss counters
 *   - clearMemory()
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import module functions directly — module-level singleton is shared.
import {
    getFromMemory,
    setInMemory,
    clearMemory,
    getMemoryStats,
} from '../mcp-server/tools/lib/working-memory.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TS1 = '2024-01-01T00:00:00.000Z'; // build timestamp A
const TS2 = '2024-01-02T00:00:00.000Z'; // build timestamp B (different)

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    clearMemory();
    vi.useRealTimers();
});

afterEach(() => {
    vi.useRealTimers();
    clearMemory();
});

// ── Basic get/set ─────────────────────────────────────────────────────────────

describe('WorkingMemory — basic get/set', () => {
    it('returns undefined on cache miss', () => {
        expect(getFromMemory('missing-key', TS1)).toBeUndefined();
    });

    it('returns stored value on cache hit', () => {
        setInMemory('key1', { data: 42 }, TS1);
        expect(getFromMemory<{ data: number }>('key1', TS1)).toEqual({ data: 42 });
    });

    it('returns undefined for unknown key after some entries set', () => {
        setInMemory('a', 1, TS1);
        setInMemory('b', 2, TS1);
        expect(getFromMemory('c', TS1)).toBeUndefined();
    });

    it('stores and retrieves primitive values', () => {
        setInMemory('num', 99, TS1);
        expect(getFromMemory<number>('num', TS1)).toBe(99);

        setInMemory('str', 'hello', TS1);
        expect(getFromMemory<string>('str', TS1)).toBe('hello');

        setInMemory('bool', true, TS1);
        expect(getFromMemory<boolean>('bool', TS1)).toBe(true);
    });

    it('stores and retrieves arrays', () => {
        setInMemory('arr', [1, 2, 3], TS1);
        expect(getFromMemory<number[]>('arr', TS1)).toEqual([1, 2, 3]);
    });
});

// ── structuredClone protection ────────────────────────────────────────────────

describe('WorkingMemory — structuredClone protection', () => {
    it('mutating retrieved value does not affect cached entry', () => {
        setInMemory('obj', { x: 1 }, TS1);

        const first = getFromMemory<{ x: number }>('obj', TS1);
        expect(first).toBeDefined();
        first!.x = 999;

        // Second retrieval should return original value
        const second = getFromMemory<{ x: number }>('obj', TS1);
        expect(second?.x).toBe(1);
    });

    it('returned arrays are independent copies', () => {
        const original = [1, 2, 3];
        setInMemory('list', original, TS1);

        const retrieved = getFromMemory<number[]>('list', TS1);
        retrieved!.push(4);
        original.push(5);

        const second = getFromMemory<number[]>('list', TS1);
        expect(second).toEqual([1, 2, 3]); // unchanged
    });
});

// ── buildTimestamp invalidation ───────────────────────────────────────────────

describe('WorkingMemory — buildTimestamp invalidation', () => {
    it('invalidates when buildTimestamp differs from stored value', () => {
        setInMemory('key', 'value', TS1);
        expect(getFromMemory('key', TS2)).toBeUndefined();
    });

    it('returns value when buildTimestamp matches', () => {
        setInMemory('key', 'value', TS1);
        expect(getFromMemory('key', TS1)).toBe('value');
    });

    it('after invalidation the key is gone (subsequent access also misses)', () => {
        setInMemory('key', 'value', TS1);
        getFromMemory('key', TS2); // invalidates
        expect(getFromMemory('key', TS1)).toBeUndefined(); // entry deleted
    });
});

// ── TTL expiry ────────────────────────────────────────────────────────────────

describe('WorkingMemory — TTL expiry (5 minutes)', () => {
    it('entry is available before TTL expires', () => {
        vi.useFakeTimers();
        setInMemory('k', 'v', TS1);

        // Advance time by 4 minutes (within TTL)
        vi.advanceTimersByTime(4 * 60 * 1000);
        expect(getFromMemory('k', TS1)).toBe('v');
    });

    it('entry expires after 5 minutes (REQ-018 TTL)', () => {
        vi.useFakeTimers();
        setInMemory('k', 'v', TS1);

        // Advance past 5 minutes TTL
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        expect(getFromMemory('k', TS1)).toBeUndefined();
    });

    it('TTL is checked lazily on access — not by background timer', () => {
        vi.useFakeTimers();
        setInMemory('k', 'v', TS1);
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Entry should be gone on first access
        const result = getFromMemory('k', TS1);
        expect(result).toBeUndefined();
    });
});

// ── LRU eviction at capacity 50 ───────────────────────────────────────────────

describe('WorkingMemory — LRU eviction', () => {
    it('evicts oldest (first-inserted) entry when capacity (50) is reached', () => {
        // Fill to capacity
        for (let i = 0; i < 50; i++) {
            setInMemory(`key-${i}`, i, TS1);
        }

        // Adding entry 51 should evict key-0 (oldest)
        setInMemory('key-50', 50, TS1);
        expect(getFromMemory('key-0', TS1)).toBeUndefined();
        expect(getFromMemory('key-50', TS1)).toBe(50);
    });

    it('LRU: accessed entry is moved to back — survives when others are evicted', () => {
        // Fill to 50
        for (let i = 0; i < 50; i++) {
            setInMemory(`key-${i}`, i, TS1);
        }

        // Access key-0 to refresh its LRU position (now most-recently-used)
        getFromMemory('key-0', TS1);

        // Adding 2 more entries should evict key-1 and key-2 (now oldest)
        setInMemory('key-50', 50, TS1);
        setInMemory('key-51', 51, TS1);

        expect(getFromMemory('key-0', TS1)).toBe(0); // survived (was accessed)
        expect(getFromMemory('key-1', TS1)).toBeUndefined(); // evicted
    });

    it('never exceeds 50 entries regardless of how many are added', () => {
        for (let i = 0; i < 100; i++) {
            setInMemory(`key-${i}`, i, TS1);
        }
        // Can't directly check size, but stats.entries should be ≤ 50
        const stats = getMemoryStats();
        expect(stats.entries).toBeLessThanOrEqual(50);
    });
});

// ── Hit / miss counters ───────────────────────────────────────────────────────

describe('WorkingMemory — hit/miss counters', () => {
    it('tracks miss for absent key', () => {
        const before = getMemoryStats();
        getFromMemory('nonexistent', TS1);
        const after = getMemoryStats();
        expect(after.misses).toBeGreaterThan(before.misses);
    });

    it('tracks hit for present key', () => {
        setInMemory('present', 42, TS1);
        const before = getMemoryStats();
        getFromMemory('present', TS1);
        const after = getMemoryStats();
        expect(after.hits).toBeGreaterThan(before.hits);
    });

    it('miss on expired entry (TTL)', () => {
        vi.useFakeTimers();
        setInMemory('k', 'v', TS1);
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);

        const before = getMemoryStats();
        getFromMemory('k', TS1);
        const after = getMemoryStats();
        expect(after.misses).toBeGreaterThan(before.misses);
    });

    it('miss on buildTimestamp mismatch', () => {
        setInMemory('k', 'v', TS1);
        const before = getMemoryStats();
        getFromMemory('k', TS2);
        const after = getMemoryStats();
        expect(after.misses).toBeGreaterThan(before.misses);
    });
});

// ── clearMemory ───────────────────────────────────────────────────────────────

describe('WorkingMemory — clearMemory', () => {
    it('removes all entries', () => {
        setInMemory('a', 1, TS1);
        setInMemory('b', 2, TS1);
        clearMemory();
        expect(getFromMemory('a', TS1)).toBeUndefined();
        expect(getFromMemory('b', TS1)).toBeUndefined();
    });

    it('entries count is 0 after clear', () => {
        setInMemory('a', 1, TS1);
        clearMemory();
        expect(getMemoryStats().entries).toBe(0);
    });

    it('can store entries after clear', () => {
        setInMemory('a', 1, TS1);
        clearMemory();
        setInMemory('b', 2, TS1);
        expect(getFromMemory('b', TS1)).toBe(2);
    });
});
