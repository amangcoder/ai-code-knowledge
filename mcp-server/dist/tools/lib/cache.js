/**
 * In-process LRU cache module for MCP server.
 * Module-level singleton shared across all tool handlers in one Node.js process.
 * Invalidates all entries when the index build timestamp changes.
 *
 * No external dependencies — implemented using native Map (ES2015+ insertion-order).
 */
// ── Configuration ─────────────────────────────────────────────────────────────
const DEFAULT_MAX_ENTRIES = 16;
const MIN_ENTRIES = 4;
const MAX_ENTRIES_LIMIT = 10000;
function parseMaxEntries() {
    const raw = process.env['KNOWLEDGE_CACHE_MAX_ENTRIES'];
    if (raw === undefined || raw === '')
        return DEFAULT_MAX_ENTRIES;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
        process.stderr.write(`[cache] WARNING: KNOWLEDGE_CACHE_MAX_ENTRIES="${raw}" is not a number, using default ${DEFAULT_MAX_ENTRIES}\n`);
        return DEFAULT_MAX_ENTRIES;
    }
    if (parsed < MIN_ENTRIES || parsed > MAX_ENTRIES_LIMIT) {
        process.stderr.write(`[cache] WARNING: KNOWLEDGE_CACHE_MAX_ENTRIES=${parsed} out of range [${MIN_ENTRIES}-${MAX_ENTRIES_LIMIT}], using default ${DEFAULT_MAX_ENTRIES}\n`);
        return DEFAULT_MAX_ENTRIES;
    }
    return parsed;
}
// ── Singleton state ───────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map();
let maxEntries = parseMaxEntries();
let hits = 0;
let misses = 0;
// ── LRU helpers ───────────────────────────────────────────────────────────────
/** Evicts the oldest entry (first insertion-order key in Map). */
function evictOldest() {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) {
        store.delete(oldestKey);
    }
}
/** Refreshes a key's LRU position by delete-then-reinsert. */
function touch(key, entry) {
    store.delete(key);
    store.set(key, entry);
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Get a cached value or load it from disk.
 *
 * (a) Cache hit + timestamps match → return cached value (increment hits)
 * (b) Cache hit + timestamp differs → full cache invalidation, then reload
 * (c) Cache miss → call loader(), cache result (increment misses)
 *
 * @param key Cache key string
 * @param loader Function that loads data from disk; returns T or null
 * @param currentTimestamp index.lastBuilt timestamp string
 */
export function getOrLoad(key, loader, currentTimestamp) {
    const existing = store.get(key);
    if (existing !== undefined) {
        if (existing.timestamp === currentTimestamp) {
            // Cache hit — refresh LRU position and return clone
            touch(key, existing);
            hits++;
            // Return structuredClone to prevent mutation of cached data
            return structuredClone(existing.value);
        }
        else {
            // Timestamp mismatch — index was rebuilt, invalidate ALL entries
            store.clear();
        }
    }
    // Cache miss (or just cleared)
    misses++;
    const value = loader();
    if (value === null)
        return null;
    // Evict oldest if at capacity
    if (store.size >= maxEntries) {
        evictOldest();
    }
    store.set(key, { value, timestamp: currentTimestamp });
    // Return a clone so callers can't corrupt the cached reference
    return structuredClone(value);
}
/**
 * Invalidate a single cache entry, or all entries if key is omitted.
 */
export function invalidate(key) {
    if (key === undefined) {
        store.clear();
    }
    else {
        store.delete(key);
    }
}
/**
 * Override the max entries limit at runtime.
 * Immediately evicts oldest entries if current size exceeds new limit.
 */
export function setMaxEntries(n) {
    const clamped = Math.max(MIN_ENTRIES, Math.min(MAX_ENTRIES_LIMIT, n));
    maxEntries = clamped;
    while (store.size > maxEntries) {
        evictOldest();
    }
}
/**
 * Returns cache observability stats.
 */
export function getCacheStats() {
    return { hits, misses, entries: store.size };
}
