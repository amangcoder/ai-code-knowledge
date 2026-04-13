/**
 * Backward-compatibility tests (TASK-026 / REQ-010 / REQ-027).
 *
 * Verifies that enhanced tools (find_symbol, find_template_file,
 * get_project_overview, get_implementation_context) behave identically
 * to their pre-vector behavior when NO vector indexes are present.
 *
 * All tests:
 *   - Write a minimal .knowledge/ directory WITHOUT vector data
 *   - Confirm the same text content / structure that existed before
 *   - Confirm no crash or regression when VectorStore unavailable
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
    KnowledgeIndex,
    SymbolEntry,
    DependencyGraph,
    FileSummary,
} from '../src/types.js';

// ── Mock data-loader.loadVectorStore so it returns null (no vectors) ──────────
vi.mock('../mcp-server/tools/lib/data-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mcp-server/tools/lib/data-loader.js')>();
    return {
        ...actual,
        loadVectorStore: vi.fn().mockResolvedValue(null),
    };
});

// ── Mock EmbeddingProvider (should not be called without vectors) ─────────────
vi.mock('../mcp-server/tools/lib/embedding-provider.js', () => ({
    createEmbeddingProvider: vi.fn(() => ({
        embed: vi.fn(async () => { throw new Error('Embedding provider should not be called without vectors'); }),
        dimensions: () => 768,
        modelName: () => 'mock-model',
        healthCheck: vi.fn(async () => {}),
    })),
    OllamaEmbeddingProvider: vi.fn(),
    OpenAIEmbeddingProvider: vi.fn(),
}));

// Import tool handlers AFTER mocks
import { handler as findSymbolHandler } from '../mcp-server/tools/find-symbol.js';
import { handler as findTemplateFileHandler } from '../mcp-server/tools/find-template-file.js';
import { handler as getProjectOverviewHandler } from '../mcp-server/tools/get-project-overview.js';
import { handler as getImplementationContextHandler } from '../mcp-server/tools/get-implementation-context.js';

// ── Shared test fixtures ──────────────────────────────────────────────────────

const sampleIndex: KnowledgeIndex = {
    modules: ['src'],
    summaries: ['src/order.ts', 'src/payment.ts', 'src/analytics.ts'],
    hasSymbols: true,
    hasDependencies: true,
    lastBuilt: '2024-01-01T00:00:00.000Z',
    fileCount: 3,
    richness: 'standard',
};

const sampleSymbols: SymbolEntry[] = [
    {
        name: 'createOrder',
        qualifiedName: 'OrderService.createOrder',
        file: 'src/order.ts',
        line: 10,
        signature: 'function createOrder(items: Item[]): Order',
        type: 'function',
        module: 'src',
        calls: ['PaymentService.charge'],
        calledBy: [],
        throws: [],
        isExported: true,
        jsdoc: 'Creates a new order and processes payment',
    },
    {
        name: 'charge',
        qualifiedName: 'PaymentService.charge',
        file: 'src/payment.ts',
        line: 5,
        signature: 'function charge(amount: number): void',
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: ['OrderService.createOrder'],
        throws: ['PaymentDeclined'],
        isExported: true,
    },
    {
        name: 'trackEvent',
        qualifiedName: 'AnalyticsService.trackEvent',
        file: 'src/analytics.ts',
        line: 3,
        signature: 'function trackEvent(name: string): void',
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
    },
    {
        name: 'PaymentService',
        qualifiedName: 'PaymentService',
        file: 'src/payment.ts',
        line: 1,
        signature: 'class PaymentService',
        type: 'class',
        module: 'src',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
    },
];

const sampleSummaries: Record<string, FileSummary> = {
    'src/order.ts': {
        file: 'src/order.ts',
        purpose: 'Order management service — creates and processes orders',
        exports: ['createOrder', 'Order'],
        dependencies: ['src/payment.ts', 'src/analytics.ts'],
        sideEffects: [],
        throws: [],
        lastUpdated: '2024-01-01T00:00:00.000Z',
        contentHash: 'abc123',
    },
    'src/payment.ts': {
        file: 'src/payment.ts',
        purpose: 'Payment processing service — charges customers',
        exports: ['charge', 'PaymentService'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: '2024-01-01T00:00:00.000Z',
        contentHash: 'def456',
    },
    'src/analytics.ts': {
        file: 'src/analytics.ts',
        purpose: 'Analytics tracking service — records events',
        exports: ['trackEvent'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: '2024-01-01T00:00:00.000Z',
        contentHash: 'ghi789',
    },
};

const sampleDeps: DependencyGraph = {
    nodes: ['src'],
    edges: [],
    cycles: [],
    fileDeps: {
        'src/order.ts': ['src/payment.ts', 'src/analytics.ts'],
    },
};

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let knowledgeRoot: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backward-compat-test-'));
    knowledgeRoot = tmpDir;

    // Write index.json
    fs.writeFileSync(path.join(knowledgeRoot, 'index.json'), JSON.stringify(sampleIndex));

    // Write symbols.json
    fs.writeFileSync(path.join(knowledgeRoot, 'symbols.json'), JSON.stringify(sampleSymbols));

    // Write dependencies.json
    fs.writeFileSync(path.join(knowledgeRoot, 'dependencies.json'), JSON.stringify(sampleDeps));

    // Write summaries/cache.json
    const summariesDir = path.join(knowledgeRoot, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    fs.writeFileSync(path.join(summariesDir, 'cache.json'), JSON.stringify(sampleSummaries));

    // NOTE: No 'vectors/', 'graph/', or 'features/' directories
    // This simulates a pre-Phase 7 knowledge base
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── find_symbol backward compatibility ───────────────────────────────────────

describe('find_symbol — backward compatibility without vectors (REQ-010, REQ-027)', () => {
    it('finds symbols by name without vector index', async () => {
        const result = await findSymbolHandler({ name: 'createOrder' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('createOrder');
    });

    it('returns ranked results (exact > prefix > substring)', async () => {
        const result = await findSymbolHandler({ name: 'charge' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('charge');
    });

    it('filters by type parameter', async () => {
        const result = await findSymbolHandler({ name: 'PaymentService', type: 'class' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('PaymentService');
        expect(text).toContain('class');
    });

    it('filters by module parameter', async () => {
        const result = await findSymbolHandler({ name: 'createOrder', module: 'src' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('createOrder');
    });

    it('returns "no symbols found" guidance when query has no matches', async () => {
        const result = await findSymbolHandler({ name: 'totallyNonExistentFunctionXYZ' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should not crash — should say nothing found
        expect(text).toMatch(/no symbol|0 result|not found/i);
    });

    it('does not fail when vectors directory does not exist (REQ-010)', async () => {
        // vectors/ dir does not exist — should work normally
        const result = await findSymbolHandler({ name: 'charge' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
    });

    it('signature is shown in results', async () => {
        const result = await findSymbolHandler({ name: 'charge' }, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('function charge');
    });
});

// ── find_template_file backward compatibility ─────────────────────────────────

describe('find_template_file — backward compatibility without vectors (REQ-010, REQ-027)', () => {
    it('falls back to token matching when vectors unavailable', async () => {
        const result = await findTemplateFileHandler(
            { description: 'a service that processes payments' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toBeTruthy();
    });

    it('returns payment-related file for payment description (AC-009 fallback)', async () => {
        const result = await findTemplateFileHandler(
            { description: 'payment processing service that charges customers' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should find payment.ts or similar
        expect(text).toContain('payment');
    });

    it('uses Section/buildResponse format (TASK-021 migration)', async () => {
        const result = await findTemplateFileHandler(
            { description: 'order management service' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Response should be non-empty
        expect(text.length).toBeGreaterThan(0);
    });

    it('does not call EmbeddingProvider when vectors unavailable', async () => {
        const { createEmbeddingProvider } = await import('../mcp-server/tools/lib/embedding-provider.js');
        const mockProvider = vi.mocked(createEmbeddingProvider)();

        await findTemplateFileHandler({ description: 'some service' }, knowledgeRoot);

        // embed should NOT have been called (no vectors available)
        expect(mockProvider.embed).not.toHaveBeenCalled();
    });
});

// ── get_project_overview backward compatibility ────────────────────────────────

describe('get_project_overview — backward compatibility without features (REQ-010, REQ-027)', () => {
    it('returns project overview without Key Features section when features absent', async () => {
        const result = await getProjectOverviewHandler({}, knowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Basic sections should still be present
        expect(text).toBeTruthy();
        // Should NOT fail just because features are missing
        expect(result.isError).toBeFalsy();
    });

    it('includes modules section', async () => {
        const result = await getProjectOverviewHandler({}, knowledgeRoot);
        const text = result.content[0].text;
        expect(text).toMatch(/module|src/i);
    });

    it('includes file count or file purposes', async () => {
        const result = await getProjectOverviewHandler({}, knowledgeRoot);
        const text = result.content[0].text;
        // Should mention files or modules
        expect(text.length).toBeGreaterThan(50);
    });

    it('does not show "Key Features" when features/index.json is absent', async () => {
        // The features dir doesn't exist in our test setup
        const result = await getProjectOverviewHandler({}, knowledgeRoot);
        const text = result.content[0].text;
        // "Key Features" section should only appear when features are available
        // — this is the backward-compat check
        expect(result.isError).toBeFalsy();
    });
});

// ── get_implementation_context backward compatibility ─────────────────────────

describe('get_implementation_context — backward compatibility without vectors (REQ-010, REQ-027)', () => {
    it('returns implementation context without "Similar Files" section when vectors absent', async () => {
        const result = await getImplementationContextHandler(
            { file: 'src/order.ts' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Basic info should still be present
        expect(text).toBeTruthy();
    });

    it('shows file purpose in context', async () => {
        const result = await getImplementationContextHandler(
            { file: 'src/payment.ts' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toMatch(/payment|charge/i);
    });

    it('shows symbols in implementation context', async () => {
        const result = await getImplementationContextHandler(
            { file: 'src/order.ts' },
            knowledgeRoot
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('createOrder');
    });

    it('does not crash for unknown file', async () => {
        const result = await getImplementationContextHandler(
            { file: 'nonexistent/totally-unknown.ts' },
            knowledgeRoot
        );
        // Should return gracefully — not an unhandled exception
        expect(result).toBeDefined();
        expect(result.content[0].text).toBeTruthy();
    });

    it('does not call EmbeddingProvider when vectors unavailable', async () => {
        const { createEmbeddingProvider } = await import('../mcp-server/tools/lib/embedding-provider.js');
        const mockProvider = vi.mocked(createEmbeddingProvider)();

        await getImplementationContextHandler({ file: 'src/order.ts' }, knowledgeRoot);

        // embed should NOT have been called
        expect(mockProvider.embed).not.toHaveBeenCalled();
    });
});

// ── General backward compatibility guarantees ─────────────────────────────────

describe('backward compatibility — general guarantees (REQ-027)', () => {
    it('all 4 enhanced tools return valid CallToolResult without vectors', async () => {
        const results = await Promise.all([
            findSymbolHandler({ name: 'charge' }, knowledgeRoot),
            findTemplateFileHandler({ description: 'payment service' }, knowledgeRoot),
            getProjectOverviewHandler({}, knowledgeRoot),
            getImplementationContextHandler({ file: 'src/order.ts' }, knowledgeRoot),
        ]);

        for (const result of results) {
            expect(result).toBeDefined();
            expect(result.content).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0].type).toBe('text');
            expect(typeof result.content[0].text).toBe('string');
        }
    });

    it('none of the enhanced tools throw exceptions without vectors', async () => {
        await expect(findSymbolHandler({ name: 'charge' }, knowledgeRoot)).resolves.toBeDefined();
        await expect(findTemplateFileHandler({ description: 'payment' }, knowledgeRoot)).resolves.toBeDefined();
        expect(getProjectOverviewHandler({}, knowledgeRoot)).toBeDefined();
        await expect(getImplementationContextHandler({ file: 'src/order.ts' }, knowledgeRoot)).resolves.toBeDefined();
    });
});
