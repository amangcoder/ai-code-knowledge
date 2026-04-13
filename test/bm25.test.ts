/**
 * Unit tests for BM25Index (mcp-server/tools/lib/bm25-index.ts).
 *
 * Covers:
 *   - Tokenization: camelCase, snake_case, dot notation, case folding
 *   - BM25 scoring: correct ranking, sorted output, empty index
 *   - addDocument: idempotent re-indexing
 *   - search: topK truncation, score descending order
 *   - clear / documentCount
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Index, createBM25Index } from '../mcp-server/tools/lib/bm25-index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIndex(...docs: Array<[string, string]>): BM25Index {
    const idx = new BM25Index();
    for (const [id, text] of docs) {
        idx.addDocument(id, text);
    }
    return idx;
}

// ── Tokenization (tested indirectly via addDocument + search) ─────────────────

describe('BM25Index — tokenization', () => {
    it('splits camelCase identifiers into tokens', () => {
        const idx = makeIndex(
            ['d1', 'buildCallGraph'],
            ['d2', 'unrelated content here']
        );
        const results = idx.search('call graph', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe('d1');
    });

    it('splits snake_case identifiers', () => {
        const idx = makeIndex(
            ['d1', 'extract_deps function'],
            ['d2', 'irrelevant data']
        );
        const results = idx.search('extract deps', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe('d1');
    });

    it('splits dot notation (obj.method)', () => {
        const idx = makeIndex(
            ['d1', 'cache.getOrLoad retrieval'],
            ['d2', 'other content']
        );
        const results = idx.search('cache getOrLoad', 5);
        expect(results[0].id).toBe('d1');
    });

    it('is case-insensitive — query "AUTH" matches "auth"', () => {
        const idx = makeIndex(['d1', 'auth token validation']);
        const results = idx.search('AUTH', 5);
        expect(results[0].id).toBe('d1');
    });

    it('handles PascalCase like "OrderService"', () => {
        const idx = makeIndex(
            ['d1', 'OrderService handles payment flow'],
            ['d2', 'unrelated file']
        );
        const results = idx.search('order service', 5);
        expect(results[0].id).toBe('d1');
    });

    it('handles empty string without throwing', () => {
        const idx = makeIndex(['d1', 'some content']);
        const results = idx.search('', 5);
        expect(results).toEqual([]);
    });
});

// ── BM25 scoring ──────────────────────────────────────────────────────────────

describe('BM25Index — scoring and ranking', () => {
    it('returns empty results for empty index', () => {
        const idx = new BM25Index();
        expect(idx.search('anything', 10)).toEqual([]);
    });

    it('returns empty results when no documents match', () => {
        const idx = makeIndex(['d1', 'authentication login session']);
        const results = idx.search('database query', 5);
        expect(results).toEqual([]);
    });

    it('ranks more-relevant documents higher', () => {
        const idx = makeIndex(
            ['d1', 'authentication login session JWT token validation flow'],
            ['d2', 'database query optimization index schema'],
            ['d3', 'authentication token']
        );
        const results = idx.search('authentication JWT', 3);
        expect(results[0].id).toBe('d1'); // highest relevance
    });

    it('results are sorted by score descending', () => {
        const idx = makeIndex(
            ['d1', 'cache invalidation strategy expiry'],
            ['d2', 'cache'],
            ['d3', 'invalidation']
        );
        const results = idx.search('cache invalidation', 3);
        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
    });

    it('all scores are non-negative', () => {
        const idx = makeIndex(
            ['d1', 'authentication'],
            ['d2', 'database'],
            ['d3', 'cache invalidation strategy']
        );
        const results = idx.search('cache', 5);
        for (const r of results) {
            expect(r.score).toBeGreaterThanOrEqual(0);
        }
    });

    it('respects topK limit', () => {
        const idx = new BM25Index();
        for (let i = 0; i < 20; i++) {
            idx.addDocument(`d${i}`, `item ${i} cache`);
        }
        const results = idx.search('cache', 5);
        expect(results.length).toBeLessThanOrEqual(5);
    });
});

// ── addDocument (idempotency) ─────────────────────────────────────────────────

describe('BM25Index — addDocument', () => {
    it('re-indexing same ID replaces old content', () => {
        const idx = new BM25Index();
        idx.addDocument('d1', 'authentication token');
        idx.addDocument('d1', 'database query'); // replace

        // After replacement, 'authentication' should not match
        const authResults = idx.search('authentication', 5);
        expect(authResults.filter(r => r.id === 'd1')).toHaveLength(0);

        // 'database' should match
        const dbResults = idx.search('database', 5);
        expect(dbResults[0].id).toBe('d1');
    });

    it('documentCount reflects current state', () => {
        const idx = new BM25Index();
        expect(idx.documentCount()).toBe(0);
        idx.addDocument('a', 'hello world');
        idx.addDocument('b', 'foo bar');
        expect(idx.documentCount()).toBe(2);
        idx.addDocument('a', 'replacement'); // same key — should not increase count
        expect(idx.documentCount()).toBe(2);
    });
});

// ── clear ──────────────────────────────────────────────────────────────────────

describe('BM25Index — clear', () => {
    it('clear() removes all documents', () => {
        const idx = makeIndex(['d1', 'auth'], ['d2', 'cache']);
        idx.clear();
        expect(idx.documentCount()).toBe(0);
        expect(idx.search('auth', 10)).toEqual([]);
    });

    it('can add documents after clear', () => {
        const idx = makeIndex(['d1', 'auth']);
        idx.clear();
        idx.addDocument('d2', 'new content auth');
        const results = idx.search('auth', 5);
        expect(results[0].id).toBe('d2');
    });
});

// ── createBM25Index factory ───────────────────────────────────────────────────

describe('createBM25Index factory', () => {
    it('returns a fresh BM25Index', () => {
        const idx = createBM25Index();
        expect(idx).toBeInstanceOf(BM25Index);
        expect(idx.documentCount()).toBe(0);
    });

    it('factory instances are independent', () => {
        const a = createBM25Index();
        const b = createBM25Index();
        a.addDocument('x', 'some content');
        expect(b.documentCount()).toBe(0);
    });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('BM25Index — edge cases', () => {
    it('handles single document correctly', () => {
        const idx = makeIndex(['only', 'database schema migrations']);
        const results = idx.search('schema', 5);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('only');
    });

    it('handles queries with only stop-words-like terms', () => {
        const idx = makeIndex(['d1', 'a b c d'], ['d2', 'e f g h']);
        // Should not throw, may return empty
        expect(() => idx.search('the and or', 5)).not.toThrow();
    });

    it('k1=1.5 and b=0.75 produce correct relative ranking (term saturation)', () => {
        const idx = new BM25Index();
        // d1 has 'auth' once; d2 has 'auth' many times
        idx.addDocument('d1', 'auth');
        idx.addDocument('d2', 'auth auth auth auth auth auth auth auth auth auth');

        // With BM25's term saturation (via k1), d1 should not be penalized
        // excessively. Both should match.
        const results = idx.search('auth', 5);
        expect(results.length).toBe(2);
        // d2 has more occurrences but b=0.75 normalizes for length
        // Just verify both are found and sorted by score
        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
    });
});
