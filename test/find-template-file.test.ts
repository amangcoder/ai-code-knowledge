/**
 * Tests for the find_template_file MCP tool handler (TASK-021).
 *
 * Tests run WITHOUT a live Ollama / LanceDB instance using mocks.
 * Coverage:
 *   - Vector similarity path (VectorStore available)
 *   - Token-matching fallback (VectorStore unavailable)
 *   - buildResponse/Section formatting
 *   - Input validation
 *   - AC-009: payment service ranked highest for payment description
 *   - REQ-014: vector similarity used when available
 *   - REQ-010: falls back to token matching when vectors unavailable
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type { KnowledgeIndex, FileSummary } from '../src/types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Mock loadVectorStore so tests don't require LanceDB installed
vi.mock('../mcp-server/tools/lib/data-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mcp-server/tools/lib/data-loader.js')>();
    return {
        ...actual,
        loadVectorStore: vi.fn().mockResolvedValue(null), // default: no vectors
    };
});

// Mock EmbeddingProvider factory — avoids HTTP calls to Ollama/OpenAI
vi.mock('../mcp-server/tools/lib/embedding-provider.js', () => ({
    createEmbeddingProvider: vi.fn(() => ({
        embed: vi.fn(async (texts: string[]) =>
            texts.map(() => Array.from({ length: 1024 }, (_, i) => i * 0.001))
        ),
        dimensions: () => 1024,
        modelName: () => 'mock-model',
        healthCheck: vi.fn(async () => {}),
    })),
    OllamaEmbeddingProvider: vi.fn(),
    OpenAIEmbeddingProvider: vi.fn(),
}));

// Import handler AFTER mocks are set up
import { handler } from '../mcp-server/tools/find-template-file.js';
import { loadVectorStore } from '../mcp-server/tools/lib/data-loader.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleIndex: KnowledgeIndex = {
    modules: ['sample-project'],
    summaries: [],
    hasSymbols: false,
    hasDependencies: false,
    lastBuilt: new Date().toISOString(),
    fileCount: 3,
    richness: 'standard',
};

/**
 * Sample summary cache keyed by absolute-like paths (mimicking the real build
 * pipeline output). Keys use the tmpDir prefix set in beforeAll.
 */
function makeSampleSummaries(tmpDir: string): Record<string, FileSummary> {
    const base = path.join(tmpDir, 'project');
    return {
        [`${base}/payment-service.ts`]: {
            file: 'payment-service.ts',
            purpose: 'Processes payment transactions and handles billing',
            exports: ['charge', 'refund', 'PaymentService'],
            dependencies: [],
            sideEffects: [],
            throws: ['PaymentDeclined'],
            lastUpdated: new Date().toISOString(),
            contentHash: 'pay001',
        },
        [`${base}/analytics-service.ts`]: {
            file: 'analytics-service.ts',
            purpose: 'Tracks user events and generates usage reports',
            exports: ['track', 'generateReport'],
            dependencies: [],
            sideEffects: [],
            throws: [],
            lastUpdated: new Date().toISOString(),
            contentHash: 'ana001',
        },
        [`${base}/order-service.ts`]: {
            file: 'order-service.ts',
            purpose: 'Manages order lifecycle from creation to fulfilment',
            exports: ['createOrder', 'cancelOrder'],
            dependencies: [],
            sideEffects: [],
            throws: [],
            lastUpdated: new Date().toISOString(),
            contentHash: 'ord001',
        },
    };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let knowledgeRoot: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-template-file-test-'));
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
        JSON.stringify(makeSampleSummaries(tmpDir)),
        'utf8'
    );
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    // Reset loadVectorStore mock to default (null = no vectors)
    vi.mocked(loadVectorStore).mockResolvedValue(null);
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('find_template_file — input validation', () => {
    it('returns isError when description is empty string', async () => {
        const result = await handler({ description: '' }, knowledgeRoot);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('required');
    });

    it('returns isError when description is only whitespace', async () => {
        const result = await handler({ description: '   ' }, knowledgeRoot);
        expect(result.isError).toBe(true);
    });

    it('returns isError when knowledge base is missing', async () => {
        const result = await handler(
            { description: 'payment service' },
            '/nonexistent/kb'
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('build-knowledge');
    });
});

// ── Token-matching fallback (REQ-010) ─────────────────────────────────────────

describe('find_template_file — token-matching fallback (REQ-010)', () => {
    it('returns results when VectorStore is null (fallback path)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler(
            { description: 'payment processing service' },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('payment');
    });

    it('AC-009: payment-service ranked highest for payment description (token matching)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler(
            { description: 'a service that processes payments' },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;

        // payment-service should appear first (highest score)
        const paymentIdx = text.indexOf('payment-service.ts');
        const analyticsIdx = text.indexOf('analytics-service.ts');
        const orderIdx = text.indexOf('order-service.ts');

        expect(paymentIdx).toBeGreaterThan(-1);
        // analytics and order should come after payment (if present)
        if (analyticsIdx !== -1) {
            expect(paymentIdx).toBeLessThan(analyticsIdx);
        }
        if (orderIdx !== -1) {
            expect(paymentIdx).toBeLessThan(orderIdx);
        }
    });

    it('includes Purpose, Exports and Score fields in token-match output', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler(
            { description: 'payment processing' },
            knowledgeRoot
        );

        const text = result.content[0].text;
        expect(text).toContain('Purpose:');
        expect(text).toContain('Exports:');
        expect(text).toContain('Score:');
    });

    it('returns "No matching files found" when no tokens match', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler(
            { description: 'xyzzy_quux_nonexistent_zzz' },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('No matching files found');
    });

    it('output uses Section header with description', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler(
            { description: 'analytics tracking' },
            knowledgeRoot
        );

        const text = result.content[0].text;
        expect(text).toContain('Template Suggestions for: "analytics tracking"');
    });
});

// ── Vector similarity path (REQ-014) ─────────────────────────────────────────

describe('find_template_file — vector similarity search (REQ-014)', () => {
    it('uses VectorStore.searchFiles when VectorStore is available', async () => {
        const mockSearchFiles = vi.fn().mockResolvedValue([
            {
                id: 'file:payment-service.ts',
                score: 0.92,
                metadata: {
                    purpose: 'Processes payment transactions and handles billing',
                    exports: 'charge, refund, PaymentService',
                },
            },
        ]);

        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: mockSearchFiles,
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { description: 'a service that processes payments' },
            knowledgeRoot
        );

        expect(result.isError).toBeFalsy();
        // Should have called vector search
        expect(mockSearchFiles).toHaveBeenCalledOnce();
        const text = result.content[0].text;
        expect(text).toContain('payment-service.ts');
    });

    it('AC-009: payment service returned first in vector results', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                {
                    id: 'file:payment-service.ts',
                    score: 0.95,
                    metadata: {
                        purpose: 'Processes payment transactions and handles billing',
                        exports: 'charge, refund',
                    },
                },
                {
                    id: 'file:order-service.ts',
                    score: 0.7,
                    metadata: {
                        purpose: 'Manages order lifecycle',
                        exports: 'createOrder',
                    },
                },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler(
            { description: 'a service that processes payments' },
            knowledgeRoot
        );

        const text = result.content[0].text;
        const paymentIdx = text.indexOf('payment-service.ts');
        const orderIdx = text.indexOf('order-service.ts');
        expect(paymentIdx).toBeGreaterThan(-1);
        expect(paymentIdx).toBeLessThan(orderIdx);
    });

    it('includes Score field with numeric value in vector results', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                {
                    id: 'file:payment-service.ts',
                    score: 0.88,
                    metadata: { purpose: 'Processes payments' },
                },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'payment' }, knowledgeRoot);
        const text = result.content[0].text;
        expect(text).toContain('Score:');
        expect(text).toMatch(/Score: 0\.\d+/);
    });

    it('includes Purpose from vector metadata', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                {
                    id: 'file:analytics-service.ts',
                    score: 0.82,
                    metadata: {
                        purpose: 'Tracks user events and generates usage reports',
                    },
                },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'track events' }, knowledgeRoot);
        const text = result.content[0].text;
        expect(text).toContain('Purpose:');
        expect(text).toContain('Tracks user events');
    });

    it('strips "file:" prefix from vector result IDs in output', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([
                {
                    id: 'file:src/payment-service.ts',
                    score: 0.9,
                    metadata: { purpose: 'Payment processing' },
                },
            ]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'payment' }, knowledgeRoot);
        const text = result.content[0].text;
        // Should display 'src/payment-service.ts', not 'file:src/payment-service.ts'
        expect(text).toContain('src/payment-service.ts');
        expect(text).not.toContain('file:src/payment-service.ts');
    });

    it('falls back to token matching when VectorStore returns empty results', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]), // no results
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should still return something (token match fallback)
        expect(text).toContain('payment');
    });

    it('falls back to token matching when EmbeddingProvider throws', async () => {
        const { createEmbeddingProvider } = await import(
            '../mcp-server/tools/lib/embedding-provider.js'
        );
        vi.mocked(createEmbeddingProvider).mockImplementationOnce(() => {
            throw new Error('ECONNREFUSED');
        });

        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'payment processing' }, knowledgeRoot);
        // Should not throw — degrades to token matching
        expect(result.isError).toBeFalsy();
    });

    it('uses non-null VectorStore before checking isAvailable', async () => {
        // VectorStore present but isAvailable() returns false → should use token matching
        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => false,
            searchFiles: vi.fn().mockResolvedValue([]),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'payment processing' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        // Should succeed via token-matching (isAvailable=false triggers fallback)
        const text = result.content[0].text;
        expect(text).toContain('Template Suggestions');
    });
});

// ── Section / buildResponse formatting ───────────────────────────────────────

describe('find_template_file — response formatting', () => {
    it('response is within budget (≤ 12 KB)', async () => {
        // Provide many vector results to stress the budget truncation
        const manyResults = Array.from({ length: 20 }, (_, i) => ({
            id: `file:src/module-${i}.ts`,
            score: 1 - i * 0.05,
            metadata: {
                purpose: `Module ${i} — ${'x'.repeat(300)}`,
                exports: Array.from({ length: 10 }, (__, j) => `export${j}`).join(', '),
            },
        }));

        vi.mocked(loadVectorStore).mockResolvedValue({
            isAvailable: () => true,
            searchFiles: vi.fn().mockResolvedValue(manyResults),
            searchSymbols: vi.fn().mockResolvedValue([]),
            searchFeatures: vi.fn().mockResolvedValue([]),
        });

        const result = await handler({ description: 'some module' }, knowledgeRoot);
        const byteLen = Buffer.byteLength(result.content[0].text, 'utf8');
        expect(byteLen).toBeLessThanOrEqual(12_500); // 12 KB + small margin
    });

    it('includes metadata footer (index staleness info)', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);

        const result = await handler({ description: 'payment processing' }, knowledgeRoot);
        const text = result.content[0].text;
        // buildFooterSection appends index build info
        expect(text).toContain('Index:');
    });

    it('handler is async and returns a Promise', () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);
        const ret = handler({ description: 'payment' }, knowledgeRoot);
        expect(ret).toBeInstanceOf(Promise);
        return ret; // avoid unhandled promise rejection
    });

    it('result has content array with type=text', async () => {
        vi.mocked(loadVectorStore).mockResolvedValue(null);
        const result = await handler({ description: 'payment' }, knowledgeRoot);
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0].type).toBe('text');
        expect(typeof result.content[0].text).toBe('string');
    });
});
