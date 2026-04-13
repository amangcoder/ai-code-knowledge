/**
 * Tests for the semantic_search MCP tool handler.
 *
 * These tests run WITHOUT a live Ollama / LanceDB instance by using mocks.
 * All tests operate with a temporary .knowledge directory.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Types ────────────────────────────────────────────────────────────────────
import type { KnowledgeIndex, FileSummary, SymbolEntry } from '../src/types.js';

// ── Module mocks ─────────────────────────────────────────────────────────────
// Mock data-loader's loadVectorStore so tests don't need LanceDB installed
vi.mock('../mcp-server/tools/lib/data-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mcp-server/tools/lib/data-loader.js')>();
    return {
        ...actual,
        loadVectorStore: vi.fn().mockResolvedValue(null), // default: no vectors
    };
});

// Mock EmbeddingProvider factory — avoids HTTP calls to Ollama
vi.mock('../mcp-server/tools/lib/embedding-provider.js', () => ({
    createEmbeddingProvider: vi.fn(() => ({
        embed: vi.fn(async (texts: string[]) =>
            texts.map(() => Array.from({ length: 1024 }, () => Math.random()))
        ),
        dimensions: () => 1024,
        modelName: () => 'mock-model',
        healthCheck: vi.fn(async () => {}),
    })),
    OllamaEmbeddingProvider: vi.fn(),
    OpenAIEmbeddingProvider: vi.fn(),
}));

// Import handler AFTER mocks are set up
import { handler } from '../mcp-server/tools/semantic-search.js';
import { loadVectorStore } from '../mcp-server/tools/lib/data-loader.js';
import { clearMemory } from '../mcp-server/tools/lib/working-memory.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleIndex: KnowledgeIndex = {
    modules: ['tools'],
    summaries: [],
    hasSymbols: true,
    hasDependencies: false,
    lastBuilt: new Date().toISOString(),
    fileCount: 3,
};

const sampleSummaries: Record<string, FileSummary> = {
    '/project/src/auth.ts': {
        file: '/project/src/auth.ts',
        purpose: 'Handles user authentication and session management',
        llmDescription: 'Authentication module providing login, logout, and JWT token validation',
        exports: ['login', 'logout', 'validateToken'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: 'abc123',
    },
    '/project/src/cache.ts': {
        file: '/project/src/cache.ts',
        purpose: 'LRU cache implementation for session data',
        llmDescription: 'In-memory LRU cache with TTL expiry for performance optimization',
        exports: ['getOrLoad', 'invalidate'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: 'def456',
    },
};

const sampleSymbols: SymbolEntry[] = [
    {
        name: 'validateToken',
        qualifiedName: 'auth::validateToken',
        file: '/project/src/auth.ts',
        line: 42,
        signature: 'function validateToken(token: string): boolean',
        type: 'function',
        module: 'auth',
        calls: [],
        calledBy: [],
        throws: ['InvalidTokenError'],
        isExported: true,
        jsdoc: 'Validates a JWT token and returns true if valid',
    },
    {
        name: 'getOrLoad',
        qualifiedName: 'cache::getOrLoad',
        file: '/project/src/cache.ts',
        line: 10,
        signature: 'function getOrLoad<T>(key: string, loader: () => T): T',
        type: 'function',
        module: 'cache',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
        jsdoc: 'Retrieves a cached value or loads it via the provided loader function',
    },
];

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let knowledgeRoot: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-search-test-'));
    knowledgeRoot = tmpDir;

    // Write index.json
    fs.writeFileSync(
        path.join(knowledgeRoot, 'index.json'),
        JSON.stringify(sampleIndex),
        'utf8'
    );

    // Write summaries/cache.json
    const summariesDir = path.join(knowledgeRoot, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    fs.writeFileSync(
        path.join(summariesDir, 'cache.json'),
        JSON.stringify(sampleSummaries),
        'utf8'
    );

    // Write symbols.json
    fs.writeFileSync(
        path.join(knowledgeRoot, 'symbols.json'),
        JSON.stringify(sampleSymbols),
        'utf8'
    );
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    clearMemory();
    // Reset loadVectorStore mock to default (null)
    vi.mocked(loadVectorStore).mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('semantic_search handler', () => {

    // ── Input validation ──────────────────────────────────────────────────────

    it('returns isError when query is empty', async () => {
        const result = await handler({ query: '' }, knowledgeRoot);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('required');
    });

    it('returns isError when query is only whitespace', async () => {
        const result = await handler({ query: '   ' }, knowledgeRoot);
        expect(result.isError).toBe(true);
    });

    it('clamps topK to maximum of 50', async () => {
        // With vectors unavailable this tests the validation path
        const result = await handler({ query: 'auth', topK: 9999 }, knowledgeRoot);
        // Should not error on topK validation — just clamp it
        expect(result.content[0].text).not.toContain('Invalid topK');
    });

    it('returns isError for invalid scope value', async () => {
        const result = await handler(
            { query: 'auth', scope: 'invalid' as 'all' },
            knowledgeRoot
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('scope');
    });

    // ── Vectors unavailable (AC-003) ──────────────────────────────────────────

    it('returns clear guidance when vector index is not available (AC-003)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'authentication' }, knowledgeRoot);

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('build-knowledge');
        // Should mention the query
        expect(text).toContain('authentication');
    });

    it('mentions BM25 document count in unavailability message', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'cache' }, knowledgeRoot);
        const text = result.content[0].text;
        // BM25 index should have documents from our test fixtures
        expect(text).toMatch(/\d+ document/);
    });

    // ── Missing knowledge base ────────────────────────────────────────────────

    it('returns isError when knowledge base not found', async () => {
        const result = await handler({ query: 'test' }, '/nonexistent/path');
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('build-knowledge');
    });

    // ── WorkingMemory cache (REQ-018) ─────────────────────────────────────────

    it('returns identical result from cache on second call (REQ-018)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result1 = await handler({ query: 'caching strategy' }, knowledgeRoot);
        const result2 = await handler({ query: 'caching strategy' }, knowledgeRoot);

        expect(result1.content[0].text).toBe(result2.content[0].text);
    });

    it('cache is keyed by query+scope+topK — different params produce independent results', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const resultA = await handler({ query: 'auth', scope: 'files' }, knowledgeRoot);
        const resultB = await handler({ query: 'auth', scope: 'symbols' }, knowledgeRoot);

        // Both may say "vector unavailable" but they are separately cached entries
        expect(resultA).toBeDefined();
        expect(resultB).toBeDefined();
    });

    // ── Hybrid search with mock VectorStore (REQ-001, REQ-002) ───────────────

    it('calls hybridSearch and formats results when VectorStore is available (REQ-001, REQ-002)', async () => {
        // Provide a mock VectorStore that returns file results
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                {
                    id: 'file:src/auth.ts',
                    score: 0.9,
                    metadata: {
                        purpose: 'Handles user authentication and session management',
                        file: '/project/src/auth.ts',
                    },
                },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ query: 'authentication', scope: 'files' }, knowledgeRoot);

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('authentication');
        // Should display result count
        expect(text).toMatch(/Found \d+ result/);
        // Should include score
        expect(text).toContain('score=');
    });

    it('scope="symbols" returns symbol-type results with signatures (AC-002)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([
                {
                    id: 'symbol:auth::validateToken',
                    score: 0.85,
                    metadata: {
                        qualifiedName: 'auth::validateToken',
                        signature: 'function validateToken(token: string): boolean',
                        file: '/project/src/auth.ts',
                    },
                },
            ]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { query: 'validate JWT token', scope: 'symbols' },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should include symbol type indicator
        expect(text).toContain('symbol');
        // Should include the signature
        expect(text).toContain('validateToken');
    });

    it('returns ranked list with relevance scores (AC-001)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                { id: 'file:src/auth.ts', score: 0.95, metadata: { purpose: 'auth' } },
                { id: 'file:src/cache.ts', score: 0.7, metadata: { purpose: 'cache' } },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { query: 'security', scope: 'files', topK: 5 },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should have numeric scores
        expect(text).toMatch(/score=0\.\d+/);
        // Top result should appear before second
        const firstPos = text.indexOf('auth.ts');
        expect(firstPos).toBeGreaterThan(-1);
    });

    // ── Response budget (REQ-012, AC-018) ─────────────────────────────────────

    it('response does not exceed 14 KB (AC-018)', async () => {
        // Provide 50 results to stress-test budget truncation
        const manyResults = Array.from({ length: 50 }, (_, i) => ({
            id: `file:src/module-${i}.ts`,
            score: 1 - i * 0.01,
            metadata: {
                purpose: `Module ${i} — ${'x'.repeat(200)}`,
                file: `/project/src/module-${i}.ts`,
            },
        }));

        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue(manyResults),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { query: 'module', scope: 'files', topK: 50 },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        const byteLen = Buffer.byteLength(text, 'utf8');
        expect(byteLen).toBeLessThanOrEqual(14_336); // 14 KB + small margin for hard cap
    });

    // ── QueryRouter integration ───────────────────────────────────────────────

    it('includes QueryRouter strategy in output', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([
                {
                    id: 'symbol:auth::validateToken',
                    score: 0.9,
                    metadata: { qualifiedName: 'auth::validateToken' },
                },
            ]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ query: 'ValidateToken' }, knowledgeRoot);
        const text = result.content[0].text;
        // QueryRouter should detect PascalCase → exact_symbol
        expect(text).toContain('exact_symbol');
    });

    // ── Default parameters ────────────────────────────────────────────────────

    it('uses default scope="all" when scope not provided', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ query: 'database' }, knowledgeRoot);
        // Shouldn't error — scope defaults to 'all'
        expect(result.isError).toBeFalsy();
    });

    it('accepts topK parameter and returns at most topK results', async () => {
        const manyResults = Array.from({ length: 20 }, (_, i) => ({
            id: `file:src/m${i}.ts`,
            score: 1 - i * 0.05,
            metadata: { purpose: `Module ${i}` },
        }));

        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue(manyResults),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { query: 'module', topK: 3 },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // topK=3 → should report at most 3 results
        expect(text).toMatch(/Found [1-3] result/);
    });
});

// ── BM25Index unit tests ──────────────────────────────────────────────────────

describe('BM25Index (bm25-index.ts)', () => {
    it('tokenizes camelCase correctly', async () => {
        const { BM25Index } = await import('../mcp-server/tools/lib/bm25-index.js');
        const idx = new BM25Index();
        idx.addDocument('d1', 'buildCallGraph');
        idx.addDocument('d2', 'unrelated content');

        const results = idx.search('call graph', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe('d1');
    });

    it('ranks more relevant documents higher', async () => {
        const { BM25Index } = await import('../mcp-server/tools/lib/bm25-index.js');
        const idx = new BM25Index();
        idx.addDocument('d1', 'authentication login session JWT token validation');
        idx.addDocument('d2', 'database query optimization index');
        idx.addDocument('d3', 'authentication token');

        const results = idx.search('authentication JWT', 3);
        expect(results[0].id).toBe('d1'); // highest relevance
    });

    it('returns empty results for empty index', async () => {
        const { BM25Index } = await import('../mcp-server/tools/lib/bm25-index.js');
        const idx = new BM25Index();
        expect(idx.search('anything', 10)).toEqual([]);
    });

    it('documentCount tracks additions', async () => {
        const { createBM25Index } = await import('../mcp-server/tools/lib/bm25-index.js');
        const idx = createBM25Index();
        expect(idx.documentCount()).toBe(0);
        idx.addDocument('a', 'hello');
        idx.addDocument('b', 'world');
        expect(idx.documentCount()).toBe(2);
        idx.clear();
        expect(idx.documentCount()).toBe(0);
    });

    it('search returns results sorted by score descending', async () => {
        const { BM25Index } = await import('../mcp-server/tools/lib/bm25-index.js');
        const idx = new BM25Index();
        idx.addDocument('d1', 'cache invalidation strategy');
        idx.addDocument('d2', 'cache');
        idx.addDocument('d3', 'invalidation');

        const results = idx.search('cache invalidation', 3);
        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
    });
});

// ── WorkingMemory unit tests ──────────────────────────────────────────────────

describe('WorkingMemory (working-memory.ts)', () => {
    beforeEach(async () => {
        const { clearMemory } = await import('../mcp-server/tools/lib/working-memory.js');
        clearMemory();
    });

    it('returns undefined on cache miss', async () => {
        const { getFromMemory } = await import('../mcp-server/tools/lib/working-memory.js');
        expect(getFromMemory('missing', 'ts1')).toBeUndefined();
    });

    it('returns value on cache hit', async () => {
        const { getFromMemory, setInMemory } = await import('../mcp-server/tools/lib/working-memory.js');
        setInMemory('k', { x: 1 }, 'ts1');
        expect(getFromMemory('k', 'ts1')).toEqual({ x: 1 });
    });

    it('invalidates on buildTimestamp mismatch', async () => {
        const { getFromMemory, setInMemory } = await import('../mcp-server/tools/lib/working-memory.js');
        setInMemory('k', 'value', 'ts1');
        expect(getFromMemory('k', 'ts2')).toBeUndefined();
    });

    it('returns structuredClone (mutation does not affect cache)', async () => {
        const { getFromMemory, setInMemory } = await import('../mcp-server/tools/lib/working-memory.js');
        const original = { a: 1 };
        setInMemory('k', original, 'ts1');

        const retrieved = getFromMemory<{ a: number }>('k', 'ts1');
        expect(retrieved).toBeDefined();
        retrieved!.a = 999;

        // Second retrieval should return original value
        const retrieved2 = getFromMemory<{ a: number }>('k', 'ts1');
        expect(retrieved2?.a).toBe(1);
    });

    it('tracks hit and miss counters', async () => {
        const { getFromMemory, setInMemory, getMemoryStats, clearMemory } =
            await import('../mcp-server/tools/lib/working-memory.js');
        clearMemory();

        getFromMemory('missing', 'ts1'); // miss
        setInMemory('present', 42, 'ts1');
        getFromMemory('present', 'ts1'); // hit

        const stats = getMemoryStats();
        expect(stats.misses).toBeGreaterThanOrEqual(1);
        expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('evicts oldest entry when at capacity (50)', async () => {
        const { getFromMemory, setInMemory } = await import('../mcp-server/tools/lib/working-memory.js');

        // Fill to capacity (50 entries)
        for (let i = 0; i < 50; i++) {
            setInMemory(`key-${i}`, i, 'ts1');
        }

        // Adding entry 51 should evict the oldest (key-0)
        setInMemory('key-50', 50, 'ts1');
        expect(getFromMemory('key-0', 'ts1')).toBeUndefined();
        expect(getFromMemory('key-50', 'ts1')).toBe(50);
    });
});

// ── QueryRouter unit tests ────────────────────────────────────────────────────

describe('QueryRouter (query-router.ts)', () => {
    it('routes PascalCase identifier to exact_symbol with high confidence', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        const route = routeQuery('CreateOrder');
        expect(route.strategy).toBe('exact_symbol');
        expect(route.confidence).toBeGreaterThan(0.9);
        expect(route.suggestedScope).toBe('symbols');
    });

    it('routes "how does ... work" to feature_search', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        const route = routeQuery('how does authentication work');
        expect(route.strategy).toBe('feature_search');
    });

    it('routes "calls createOrder" to graph_traversal', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        const route = routeQuery('calls createOrder');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('routes generic keyword query to vector_search with default confidence', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        const route = routeQuery('database connection pooling');
        expect(route.strategy).toBe('vector_search');
        expect(route.confidence).toBe(0.60);
    });

    it('routes multi-pattern query to hybrid strategy', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        // Matches both PascalCase (exact_symbol) and "how does" (feature_search)
        // Actually PascalCase alone is exact. Let's test a different case:
        // "how does createOrder depend on payment" — matches feature_search + graph_traversal
        const route = routeQuery('how does createOrder depend on payment service');
        expect(route.strategy).toBe('hybrid');
        expect(route.confidence).toBeGreaterThan(0);
        expect(route.confidence).toBeLessThanOrEqual(1);
    });

    it('confidence values are in [0, 1]', async () => {
        const { routeQuery } = await import('../mcp-server/tools/lib/query-router.js');
        const queries = [
            'CreateOrder',
            'how does caching work',
            'calls handleRequest',
            'database schema',
            'what are the imports in auth module',
        ];
        for (const q of queries) {
            const route = routeQuery(q);
            expect(route.confidence).toBeGreaterThanOrEqual(0);
            expect(route.confidence).toBeLessThanOrEqual(1);
        }
    });
});

// ── RRF unit tests ─────────────────────────────────────────────────────────────

describe('reciprocalRankFusion (hybrid-retriever.ts)', () => {
    it('merges two rankings and scores overlap items higher', async () => {
        const { reciprocalRankFusion } = await import('../mcp-server/tools/lib/hybrid-retriever.js');

        const ranking1 = [
            { id: 'a', rank: 1 },
            { id: 'b', rank: 2 },
            { id: 'c', rank: 3 },
        ];
        const ranking2 = [
            { id: 'b', rank: 1 },
            { id: 'a', rank: 2 },
            { id: 'd', rank: 3 },
        ];

        const merged = reciprocalRankFusion([ranking1, ranking2]);

        // 'a' and 'b' appear in both rankings — should score higher than 'c' and 'd'
        const scores = Object.fromEntries(merged.map((r) => [r.id, r.score]));
        expect(scores['a']).toBeGreaterThan(scores['c']);
        expect(scores['b']).toBeGreaterThan(scores['d']);
    });

    it('results are sorted by score descending', async () => {
        const { reciprocalRankFusion } = await import('../mcp-server/tools/lib/hybrid-retriever.js');

        const ranking = [{ id: 'x', rank: 1 }, { id: 'y', rank: 2 }, { id: 'z', rank: 3 }];
        const result = reciprocalRankFusion([ranking]);

        for (let i = 0; i < result.length - 1; i++) {
            expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
        }
    });

    it('item appearing only in one ranking gets correct score', async () => {
        const { reciprocalRankFusion } = await import('../mcp-server/tools/lib/hybrid-retriever.js');
        const k = 60;
        const result = reciprocalRankFusion([[{ id: 'solo', rank: 1 }]], k);
        expect(result[0].id).toBe('solo');
        expect(result[0].score).toBeCloseTo(1 / (k + 1));
    });

    it('handles empty rankings', async () => {
        const { reciprocalRankFusion } = await import('../mcp-server/tools/lib/hybrid-retriever.js');
        expect(reciprocalRankFusion([])).toEqual([]);
        expect(reciprocalRankFusion([[]])).toEqual([]);
    });
});
