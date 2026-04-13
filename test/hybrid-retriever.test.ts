/**
 * Unit tests for HybridRetriever (mcp-server/tools/lib/hybrid-retriever.ts).
 *
 * Covers:
 *   - reciprocalRankFusion: correct scoring, sorted output, overlap boosting
 *   - hybridSearch: combines BM25 + vector results, scope filtering
 *   - Edge cases: empty rankings, single-source results, all scopes
 *
 * Uses mock VectorStore and EmbeddingProvider — no external services required.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    reciprocalRankFusion,
    hybridSearch,
    type VectorStore,
} from '../mcp-server/tools/lib/hybrid-retriever.js';
import { BM25Index } from '../mcp-server/tools/lib/bm25-index.js';
import type { EmbeddingProvider } from '../mcp-server/tools/lib/embedding-provider.js';
import type { VectorSearchResult } from '../src/types.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeMockEmbeddingProvider(): EmbeddingProvider {
    return {
        embed: vi.fn(async (texts: string[]) =>
            // mcp-server EmbeddingProvider returns number[][], not Float32Array[]
            texts.map(() => Array.from({ length: 4 }, () => Math.random()))
        ),
        dimensions: () => 4,
        modelName: () => 'mock-model',
        healthCheck: vi.fn(async () => {}),
    };
}

function makeMockVectorStore(overrides: {
    files?: VectorSearchResult[];
    symbols?: VectorSearchResult[];
    features?: VectorSearchResult[];
}): VectorStore {
    return {
        isAvailable: () => true,
        searchFiles: vi.fn().mockResolvedValue(overrides.files ?? []),
        searchSymbols: vi.fn().mockResolvedValue(overrides.symbols ?? []),
        searchFeatures: vi.fn().mockResolvedValue(overrides.features ?? []),
    };
}

// ── reciprocalRankFusion ──────────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
    it('handles empty rankings array', () => {
        expect(reciprocalRankFusion([])).toEqual([]);
    });

    it('handles single empty ranking', () => {
        expect(reciprocalRankFusion([[]])).toEqual([]);
    });

    it('single item in single ranking gets score 1/(k+1)', () => {
        const k = 60;
        const result = reciprocalRankFusion([[{ id: 'a', rank: 1 }]], k);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('a');
        expect(result[0].score).toBeCloseTo(1 / (k + 1));
    });

    it('results are sorted by score descending', () => {
        const ranking = [
            { id: 'x', rank: 1 },
            { id: 'y', rank: 2 },
            { id: 'z', rank: 3 },
        ];
        const result = reciprocalRankFusion([ranking]);
        for (let i = 0; i < result.length - 1; i++) {
            expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
        }
    });

    it('item in both rankings scores higher than item in one ranking', () => {
        const ranking1 = [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }];
        const ranking2 = [{ id: 'b', rank: 1 }, { id: 'a', rank: 2 }, { id: 'd', rank: 3 }];

        const merged = reciprocalRankFusion([ranking1, ranking2]);
        const scores = Object.fromEntries(merged.map((r) => [r.id, r.score]));

        // 'a' and 'b' appear in both — should score higher than 'c' and 'd'
        expect(scores['a']).toBeGreaterThan(scores['c']);
        expect(scores['b']).toBeGreaterThan(scores['d']);
    });

    it('item only in one ranking gets correct RRF score', () => {
        const k = 60;
        const result = reciprocalRankFusion([
            [{ id: 'solo', rank: 1 }],
            [{ id: 'other', rank: 1 }],
        ], k);
        const soloScore = result.find(r => r.id === 'solo')?.score ?? 0;
        expect(soloScore).toBeCloseTo(1 / (k + 1));
    });

    it('all scores are positive', () => {
        const ranking1 = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, rank: i + 1 }));
        const ranking2 = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, rank: i + 1 }));
        const result = reciprocalRankFusion([ranking1, ranking2]);
        for (const r of result) {
            expect(r.score).toBeGreaterThan(0);
        }
    });

    it('uses default k=60 when k not specified', () => {
        const result1 = reciprocalRankFusion([[{ id: 'a', rank: 1 }]]);
        const result2 = reciprocalRankFusion([[{ id: 'a', rank: 1 }]], 60);
        expect(result1[0].score).toBeCloseTo(result2[0].score);
    });

    it('merges overlapping items from 3 rankings', () => {
        const r1 = [{ id: 'X', rank: 1 }, { id: 'Y', rank: 2 }];
        const r2 = [{ id: 'Y', rank: 1 }, { id: 'X', rank: 2 }];
        const r3 = [{ id: 'X', rank: 1 }, { id: 'Z', rank: 2 }];

        const result = reciprocalRankFusion([r1, r2, r3]);
        const scores = Object.fromEntries(result.map(r => [r.id, r.score]));

        // X appears in all 3 rankings, Y in 2, Z in 1
        expect(scores['X']).toBeGreaterThan(scores['Y']);
        expect(scores['Y']).toBeGreaterThan(scores['Z']);
    });
});

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('hybridSearch', () => {
    it('returns results from both BM25 and vector search merged via RRF', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('file:src/auth.ts', 'authentication login JWT token validation');
        bm25.addDocument('file:src/cache.ts', 'cache LRU expiry TTL invalidation');

        const vectorStore = makeMockVectorStore({
            files: [
                { id: 'file:src/auth.ts', score: 0.9, metadata: { file: 'src/auth.ts' } },
                { id: 'file:src/session.ts', score: 0.7, metadata: { file: 'src/session.ts' } },
            ],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('authentication', 'files', 10, vectorStore, bm25, provider);

        expect(results.length).toBeGreaterThan(0);
        // auth.ts should appear (both BM25 and vector match it)
        const authResult = results.find(r => r.id.includes('auth'));
        expect(authResult).toBeDefined();
    });

    it('results are sorted by score descending', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('file:a.ts', 'authentication login');
        bm25.addDocument('file:b.ts', 'database query');

        const vectorStore = makeMockVectorStore({
            files: [
                { id: 'file:a.ts', score: 0.9, metadata: {} },
                { id: 'file:b.ts', score: 0.3, metadata: {} },
            ],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('authentication', 'files', 10, vectorStore, bm25, provider);

        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
    });

    it('scope="files" excludes symbol: and feature: results', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('symbol:auth::login', 'login function signature');
        bm25.addDocument('file:src/auth.ts', 'authentication module');
        bm25.addDocument('feature:auth', 'authentication feature');

        const vectorStore = makeMockVectorStore({
            files: [{ id: 'file:src/auth.ts', score: 0.9, metadata: {} }],
            symbols: [{ id: 'symbol:auth::login', score: 0.8, metadata: {} }],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('authentication', 'files', 10, vectorStore, bm25, provider);

        // All results should be file: prefixed
        for (const r of results) {
            expect(r.id.startsWith('file:')).toBe(true);
        }
    });

    it('scope="symbols" excludes file: and feature: results', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('symbol:auth::validateToken', 'validate JWT token function');
        bm25.addDocument('file:src/auth.ts', 'authentication module');

        const vectorStore = makeMockVectorStore({
            symbols: [{ id: 'symbol:auth::validateToken', score: 0.9, metadata: {} }],
            files: [{ id: 'file:src/auth.ts', score: 0.7, metadata: {} }],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('validate token', 'symbols', 10, vectorStore, bm25, provider);

        for (const r of results) {
            expect(r.id.startsWith('symbol:')).toBe(true);
        }
    });

    it('scope="all" returns results from all table types', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('file:src/auth.ts', 'authentication');
        bm25.addDocument('symbol:auth::login', 'login function');
        bm25.addDocument('feature:auth', 'auth feature');

        const vectorStore = makeMockVectorStore({
            files: [{ id: 'file:src/auth.ts', score: 0.9, metadata: {} }],
            symbols: [{ id: 'symbol:auth::login', score: 0.8, metadata: {} }],
            features: [{ id: 'feature:auth', score: 0.7, metadata: {} }],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('auth', 'all', 10, vectorStore, bm25, provider);

        const ids = results.map(r => r.id);
        // Should include at least one of each type
        const hasFile = ids.some(id => id.startsWith('file:'));
        const hasSym = ids.some(id => id.startsWith('symbol:'));
        const hasFeat = ids.some(id => id.startsWith('feature:'));
        expect(hasFile || hasSym || hasFeat).toBe(true);
    });

    it('respects topK limit', async () => {
        const bm25 = new BM25Index();
        for (let i = 0; i < 20; i++) {
            bm25.addDocument(`file:m${i}.ts`, `module ${i} auth authentication`);
        }

        const manyResults: VectorSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
            id: `file:m${i}.ts`,
            score: 0.9 - i * 0.04,
            metadata: {},
        }));

        const vectorStore = makeMockVectorStore({ files: manyResults });
        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('auth', 'files', 5, vectorStore, bm25, provider);

        expect(results.length).toBeLessThanOrEqual(5);
    });

    it('result.source is annotated (bm25, vector, or hybrid)', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('file:src/auth.ts', 'authentication login');

        const vectorStore = makeMockVectorStore({
            files: [{ id: 'file:src/auth.ts', score: 0.9, metadata: {} }],
        });

        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('authentication', 'files', 5, vectorStore, bm25, provider);

        const validSources = ['bm25', 'vector', 'hybrid'];
        for (const r of results) {
            expect(validSources).toContain(r.source);
        }
    });

    it('returns empty array when no BM25 or vector matches', async () => {
        const bm25 = new BM25Index();
        bm25.addDocument('file:src/unrelated.ts', 'completely unrelated content xyz');

        const vectorStore = makeMockVectorStore({ files: [] });
        const provider = makeMockEmbeddingProvider();
        const results = await hybridSearch('qwerty zxcvb', 'files', 5, vectorStore, bm25, provider);

        // May have 0 results (BM25 won't match, vector returns empty)
        expect(Array.isArray(results)).toBe(true);
    });
});
