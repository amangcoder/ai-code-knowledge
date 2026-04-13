/**
 * Session-scoped working memory cache with 5-minute TTL and LRU eviction.
 *
 * Module-level singleton (like cache.ts) — shared across all tool handlers
 * in one Node.js process.
 *
 * Invalidation triggers:
 *   - TTL expiry (5 minutes / 300 000 ms)
 *   - buildTimestamp mismatch (index was rebuilt)
 *   - LRU eviction when size exceeds 50 entries
 *
 * Uses structuredClone() when returning values to prevent mutation of cache.
 */

const MAX_ENTRIES = 50;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MemoryEntry<T> {
    value: T;
    insertedAt: number;
    buildTimestamp: string;
}

// ── Module-level singletons ───────────────────────────────────────────────

const store = new Map<string, MemoryEntry<unknown>>();
let hits = 0;
let misses = 0;

// ── Internal helpers ──────────────────────────────────────────────────────

/** Evict the oldest (first-inserted) entry. */
function evictOldest(): void {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) {
        store.delete(firstKey);
    }
}

/** Refresh an entry's LRU position (delete-then-reinsert preserves Map order). */
function touch<T>(key: string, entry: MemoryEntry<T>): void {
    store.delete(key);
    store.set(key, entry as MemoryEntry<unknown>);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value.
 *
 * Returns undefined when:
 *   - Key not present (cache miss)
 *   - Entry TTL has expired (lazy cleanup)
 *   - buildTimestamp differs from the current index (rebuild detected)
 *
 * On a hit: refreshes LRU position, returns structuredClone of value.
 */
export function getFromMemory<T>(key: string, currentBuildTimestamp: string): T | undefined {
    const entry = store.get(key) as MemoryEntry<T> | undefined;

    if (entry === undefined) {
        misses++;
        return undefined;
    }

    // Invalidate on index rebuild
    if (entry.buildTimestamp !== currentBuildTimestamp) {
        store.delete(key);
        misses++;
        return undefined;
    }

    // Invalidate on TTL expiry
    if (Date.now() - entry.insertedAt > TTL_MS) {
        store.delete(key);
        misses++;
        return undefined;
    }

    // Cache hit — refresh LRU position
    touch(key, entry);
    hits++;
    return structuredClone(entry.value) as T;
}

/**
 * Store a value in working memory.
 *
 * If the store is at capacity (50 entries), the oldest entry is evicted first.
 * @param key               Cache key (should be deterministic for the same query+scope+topK)
 * @param value             Value to cache
 * @param buildTimestamp    Current index.lastBuilt string (used for invalidation)
 */
export function setInMemory<T>(key: string, value: T, buildTimestamp: string): void {
    while (store.size >= MAX_ENTRIES) {
        evictOldest();
    }
    store.set(key, {
        value: structuredClone(value),
        insertedAt: Date.now(),
        buildTimestamp,
    });
}

/** Remove all entries from working memory. */
export function clearMemory(): void {
    store.clear();
}

/** Returns observability stats. */
export function getMemoryStats(): { entries: number; hits: number; misses: number } {
    return { entries: store.size, hits, misses };
}
