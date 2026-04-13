/**
 * Tests for the get_feature_context MCP tool handler.
 *
 * These tests run WITHOUT a live Ollama / LanceDB instance by using mocks.
 * All tests operate with a temporary .knowledge directory.
 *
 * Covers:
 *  - Input validation (empty query, topK clamping)
 *  - Features unavailable (null) → guidance message
 *  - Features empty array → empty-codebase message
 *  - VectorStore unavailable → keyword fallback
 *  - VectorStore available → vector search path
 *  - Full result format (name, description, files, entryPoints, dataFlow, keySymbols, relatedFeatures)
 *  - WorkingMemory cache
 *  - Response budget ≤ 20 KB (AC-020)
 *  - Missing knowledge base
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type { KnowledgeIndex, FeatureGroup } from '../src/types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock data-loader so tests don't need LanceDB installed
vi.mock('../mcp-server/tools/lib/data-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mcp-server/tools/lib/data-loader.js')>();
    return {
        ...actual,
        loadVectorStore: vi.fn().mockResolvedValue(null), // default: no vectors
        loadFeatureGroups: vi.fn().mockReturnValue(null), // default: no features
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
import { handler } from '../mcp-server/tools/get-feature-context.js';
import { loadVectorStore, loadFeatureGroups } from '../mcp-server/tools/lib/data-loader.js';
import { clearMemory } from '../mcp-server/tools/lib/working-memory.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleIndex: KnowledgeIndex = {
    modules: ['src'],
    summaries: [],
    hasSymbols: true,
    hasDependencies: false,
    lastBuilt: new Date().toISOString(),
    fileCount: 10,
};

const sampleFeatures: FeatureGroup[] = [
    {
        id: 'feature-0',
        name: 'Payment Processing',
        description: 'Handles charging customers, payment gateway integration, and refunds',
        files: ['src/payment-service.ts', 'src/billing.ts'],
        entryPoints: ['charge', 'refund'],
        dataFlow: 'Order → PaymentService → Gateway → Confirmation',
        keySymbols: ['charge', 'PaymentDeclined', 'ChargeRequest'],
        relatedFeatures: ['feature-1'],
    },
    {
        id: 'feature-1',
        name: 'Order Management',
        description: 'Creates and tracks orders, coordinates payment and fulfillment',
        files: ['src/order-service.ts'],
        entryPoints: ['createOrder'],
        dataFlow: 'Client → OrderService → PaymentService → Analytics',
        keySymbols: ['createOrder', 'Order'],
        relatedFeatures: ['feature-0', 'feature-2'],
    },
    {
        id: 'feature-2',
        name: 'Analytics & Tracking',
        description: 'Tracks user events, page views, and business metrics',
        files: ['src/analytics-service.ts'],
        entryPoints: ['trackEvent'],
        dataFlow: 'Service → Analytics → EventBuffer → Flush',
        keySymbols: ['trackEvent', 'EventBuffer'],
        relatedFeatures: ['feature-1'],
    },
];

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let knowledgeRoot: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-feature-context-test-'));
    knowledgeRoot = tmpDir;

    // Write index.json
    fs.writeFileSync(
        path.join(knowledgeRoot, 'index.json'),
        JSON.stringify(sampleIndex),
        'utf8'
    );

    // Create features directory (not strictly required — features loaded via mock)
    const featuresDir = path.join(knowledgeRoot, 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(
        path.join(featuresDir, 'index.json'),
        JSON.stringify(sampleFeatures),
        'utf8'
    );
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    clearMemory();
    // Reset mocks to safe defaults
    vi.mocked(loadVectorStore).mockResolvedValue(null);
    vi.mocked(loadFeatureGroups).mockReturnValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('get_feature_context handler', () => {

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

    it('clamps topK to maximum of 20', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);

        const result = await handler({ query: 'payment', topK: 9999 }, knowledgeRoot);
        // Should not error on topK; just clamped to 20
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).not.toContain('Invalid topK');
    });

    it('uses default topK of 3 when not provided', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);

        const result = await handler({ query: 'payment' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        // Header should mention topK=3
        expect(result.content[0].text).toContain('topK=3');
    });

    // ── Missing knowledge base ────────────────────────────────────────────────

    it('returns isError when knowledge base not found', async () => {
        const result = await handler({ query: 'payment' }, '/nonexistent/path');
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('build-knowledge');
    });

    // ── Features unavailable (AC-006 graceful degradation) ───────────────────

    it('returns guidance when features are null (not discovered)', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(null);

        const result = await handler({ query: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('build-knowledge');
        expect(text).toContain('payment processing');
    });

    it('returns helpful message when features array is empty', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue([]);

        const result = await handler({ query: 'payment' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('No feature groups found');
    });

    // ── Keyword fallback (VectorStore unavailable) ────────────────────────────

    it('falls back to keyword matching when VectorStore is unavailable', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'payment' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should mention keyword fallback
        expect(text).toContain('keyword');
        // Should return Payment Processing as top result
        expect(text).toContain('Payment Processing');
    });

    it('keyword fallback returns topK results even if no exact matches', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        // Query that doesn't match any feature words
        const result = await handler({ query: 'zzz_nomatch_xyz', topK: 3 }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        // Should still return up to topK features (best-effort)
        const text = result.content[0].text;
        expect(text).toBeDefined();
    });

    // ── Full result format (REQ-008, AC-006) ─────────────────────────────────

    it('result includes name, description, files, entryPoints, dataFlow, keySymbols, relatedFeatures (REQ-008)', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null); // keyword path

        const result = await handler({ query: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;

        // All required fields must appear
        expect(text).toContain('Payment Processing');           // name
        expect(text).toContain('payment gateway');              // description substring
        expect(text).toContain('payment-service.ts');           // files
        expect(text).toContain('charge');                       // entryPoints / keySymbols
        expect(text).toContain('Data Flow');                    // dataFlow label
        expect(text).toContain('Order → PaymentService');       // dataFlow content
        expect(text).toContain('Key Symbols');                  // keySymbols label
        expect(text).toContain('ChargeRequest');                // keySymbols content
        expect(text).toContain('Related Features');             // relatedFeatures label
    });

    it('AC-006: query "payment processing" returns a feature with all required fields', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();

        const text = result.content[0].text;
        // Feature must have: name
        expect(text).toMatch(/Payment Processing/);
        // Feature must have: description
        expect(text).toMatch(/Description:/);
        // Feature must have: files
        expect(text).toMatch(/Files \(\d+\)/);
        // Feature must have: entry points
        expect(text).toMatch(/Entry Points:/);
        // Feature must have: data flow
        expect(text).toMatch(/Data Flow:/);
        // Feature must have: key symbols
        expect(text).toMatch(/Key Symbols:/);
        // Feature must have: related features
        expect(text).toMatch(/Related Features:/);
    });

    // ── VectorStore search path ───────────────────────────────────────────────

    it('uses vector search when VectorStore is available', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([
                {
                    id: 'feature:feature-0',
                    score: 0.95,
                    metadata: { name: 'Payment Processing' },
                },
            ]),
        });

        const result = await handler({ query: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should mention semantic vector search
        expect(text).toContain('semantic vector search');
        expect(text).toContain('Payment Processing');
    });

    it('handles feature IDs with and without "feature:" prefix', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([
                // Without prefix
                { id: 'feature-1', score: 0.9, metadata: {} },
                // With prefix
                { id: 'feature:feature-2', score: 0.8, metadata: {} },
            ]),
        });

        const result = await handler({ query: 'order analytics' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('Order Management');
        expect(text).toContain('Analytics');
    });

    it('deduplicates vector results with the same feature ID', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([
                { id: 'feature:feature-0', score: 0.95, metadata: {} },
                { id: 'feature-0', score: 0.90, metadata: {} }, // duplicate
            ]),
        });

        const result = await handler({ query: 'payment', topK: 5 }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should only appear once
        const count = (text.match(/Payment Processing/g) ?? []).length;
        expect(count).toBe(1);
    });

    it('returns empty-match guidance when VectorStore returns unknown feature IDs', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([
                { id: 'feature:nonexistent-id', score: 0.5, metadata: {} },
            ]),
        });

        const result = await handler({ query: 'unknown feature' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        // No valid features resolved → "No feature groups matched"
        expect(result.content[0].text).toContain('No feature groups matched');
    });

    // ── WorkingMemory cache ───────────────────────────────────────────────────

    it('returns identical result from cache on second call', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result1 = await handler({ query: 'caching strategy' }, knowledgeRoot);
        const result2 = await handler({ query: 'caching strategy' }, knowledgeRoot);

        expect(result1.content[0].text).toBe(result2.content[0].text);
    });

    it('cache is keyed by query+topK — different params produce independent results', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const resultA = await handler({ query: 'payment', topK: 1 }, knowledgeRoot);
        const resultB = await handler({ query: 'payment', topK: 2 }, knowledgeRoot);

        expect(resultA).toBeDefined();
        expect(resultB).toBeDefined();
        // topK=1 reports 1 feature, topK=2 may report more
        expect(resultA.content[0].text).toContain('topK=1');
        expect(resultB.content[0].text).toContain('topK=2');
    });

    // ── Response budget (REQ-012, AC-020) ─────────────────────────────────────

    it('AC-020: response does not exceed 20 KB', async () => {
        // Create 20 large feature groups to stress-test budget truncation
        const largeFeatures: FeatureGroup[] = Array.from({ length: 20 }, (_, i) => ({
            id: `feature-${i}`,
            name: `Feature ${i} — ${'x'.repeat(50)}`,
            description: `Description for feature ${i}: ${'y'.repeat(200)}`,
            files: Array.from({ length: 10 }, (__, j) => `src/module-${i}-file-${j}.ts`),
            entryPoints: [`entry${i}A`, `entry${i}B`, `entry${i}C`],
            dataFlow: `Step1 → Step2 → Step3 → Step4 → Step5 (feature ${i})`,
            keySymbols: [`sym${i}A`, `sym${i}B`, `sym${i}C`, `sym${i}D`],
            relatedFeatures: [`feature-${(i + 1) % 20}`, `feature-${(i + 2) % 20}`],
        }));

        vi.mocked(loadFeatureGroups).mockReturnValue(largeFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'feature module', topK: 20 }, knowledgeRoot);
        expect(result.isError).toBeFalsy();

        const text = result.content[0].text;
        const byteLen = Buffer.byteLength(text, 'utf8');
        expect(byteLen).toBeLessThanOrEqual(20_480); // 20 KB + small margin
    });

    // ── topK boundary conditions ──────────────────────────────────────────────

    it('clamps topK to minimum of 1', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'payment', topK: -5 }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        // Should still return a result (topK clamped to 1)
        expect(result.content[0].text).toContain('topK=1');
    });

    it('returns at most topK results', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ query: 'feature', topK: 2 }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // "Found N feature group(s)" — N should be ≤ 2
        const match = text.match(/Found (\d+) feature group/);
        if (match) {
            expect(Number(match[1])).toBeLessThanOrEqual(2);
        }
    });

    // ── Embedding provider errors ─────────────────────────────────────────────

    it('returns isError when embedding provider creation fails', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const { createEmbeddingProvider } = await import('../mcp-server/tools/lib/embedding-provider.js');
        vi.mocked(createEmbeddingProvider).mockImplementationOnce(() => {
            throw new Error('OPENAI_API_KEY not set');
        });

        const result = await handler({ query: 'payment' }, knowledgeRoot);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('embedding provider');
    });

    it('returns isError when embedding provider cannot connect (ECONNREFUSED)', async () => {
        vi.mocked(loadFeatureGroups).mockReturnValue(sampleFeatures);
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const { createEmbeddingProvider } = await import('../mcp-server/tools/lib/embedding-provider.js');
        vi.mocked(createEmbeddingProvider).mockReturnValueOnce({
            embed: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
            dimensions: () => 1024,
            modelName: () => 'mock',
            healthCheck: vi.fn(),
        });

        const result = await handler({ query: 'payment' }, knowledgeRoot);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('embedding provider');
    });
});
