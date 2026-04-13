/**
 * Tests for Phase 8: GraphBuildPhase (scripts/lib/phases/graph-build-phase.ts).
 *
 * Uses temp directories with pre-written JSON fixtures.
 * No external service calls.
 *
 * Covers:
 *   - runGraphBuildPhase orchestration
 *   - Reads symbols.json, dependencies.json, summaries/cache.json
 *   - Writes graph/nodes.json and graph/edges.json
 *   - Sorted/idempotent output
 *   - Handles missing input files gracefully
 *   - GraphBuildResult fields populated correctly
 *   - Performance: completes in reasonable time
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
    SymbolEntry,
    DependencyGraph,
    FileSummary,
    GraphBuildResult,
    GraphNode,
    GraphEdge,
} from '../src/types.js';
import { runGraphBuildPhase } from '../scripts/lib/phases/graph-build-phase.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const sampleSymbols: SymbolEntry[] = [
    {
        name: 'createOrder',
        qualifiedName: 'OrderService.createOrder',
        file: '/tmp/project/src/order.ts',
        line: 10,
        signature: 'function createOrder(items: Item[]): Order',
        type: 'function',
        module: 'src',
        calls: ['PaymentService.charge', 'AnalyticsService.trackEvent'],
        calledBy: [],
        throws: [],
        isExported: true,
    },
    {
        name: 'charge',
        qualifiedName: 'PaymentService.charge',
        file: '/tmp/project/src/payment.ts',
        line: 5,
        signature: 'function charge(amount: number): void',
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: ['OrderService.createOrder'],
        throws: ['PaymentError'],
        isExported: true,
    },
];

const sampleDeps: DependencyGraph = {
    nodes: ['src', 'test'],
    edges: [{ from: 'test', to: 'src', type: 'direct' }],
    cycles: [],
    fileDeps: {
        'src/order.ts': ['src/payment.ts'],
    },
};

const sampleSummaries: Record<string, FileSummary> = {
    'src/order.ts': {
        file: 'src/order.ts',
        purpose: 'Order management service',
        exports: ['createOrder'],
        dependencies: ['payment.ts'],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: 'abc123',
    },
    'src/payment.ts': {
        file: 'src/payment.ts',
        purpose: 'Payment processing service',
        exports: ['charge'],
        dependencies: [],
        sideEffects: ['external API call'],
        throws: ['PaymentError'],
        lastUpdated: new Date().toISOString(),
        contentHash: 'def456',
    },
};

// ── Test setup helpers ────────────────────────────────────────────────────────

interface TestSetup {
    tmpDir: string;
    knowledgeRoot: string;
    writeKnowledge: (opts?: {
        symbols?: SymbolEntry[];
        deps?: DependencyGraph;
        summaries?: Record<string, FileSummary>;
    }) => void;
}

function makeTestSetup(): TestSetup {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-phase-test-'));

    const writeKnowledge = (opts: {
        symbols?: SymbolEntry[];
        deps?: DependencyGraph;
        summaries?: Record<string, FileSummary>;
    } = {}) => {
        const { symbols = sampleSymbols, deps = sampleDeps, summaries = sampleSummaries } = opts;

        fs.writeFileSync(path.join(tmpDir, 'symbols.json'), JSON.stringify(symbols), 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'dependencies.json'), JSON.stringify(deps), 'utf8');

        const summariesDir = path.join(tmpDir, 'summaries');
        fs.mkdirSync(summariesDir, { recursive: true });
        fs.writeFileSync(path.join(summariesDir, 'cache.json'), JSON.stringify(summaries), 'utf8');
    };

    return { tmpDir, knowledgeRoot: tmpDir, writeKnowledge };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runGraphBuildPhase', () => {
    let setup: TestSetup;

    beforeEach(() => {
        setup = makeTestSetup();
    });

    afterEach(() => {
        fs.rmSync(setup.tmpDir, { recursive: true, force: true });
    });

    it('returns GraphBuildResult with correct shape', async () => {
        setup.writeKnowledge();

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        expect(typeof result.nodeCount).toBe('number');
        expect(typeof result.edgeCount).toBe('number');
        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('creates graph/nodes.json', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesPath = path.join(setup.knowledgeRoot, 'graph', 'nodes.json');
        expect(fs.existsSync(nodesPath)).toBe(true);
    });

    it('creates graph/edges.json', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesPath = path.join(setup.knowledgeRoot, 'graph', 'edges.json');
        expect(fs.existsSync(edgesPath)).toBe(true);
    });

    it('nodes.json contains valid JSON array of GraphNodes', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        expect(Array.isArray(nodes)).toBe(true);
        for (const node of nodes) {
            expect(typeof node.id).toBe('string');
            expect(typeof node.type).toBe('string');
            expect(typeof node.metadata).toBe('object');
        }
    });

    it('edges.json contains valid JSON array of GraphEdges', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );
        const edges = JSON.parse(edgesRaw) as GraphEdge[];

        expect(Array.isArray(edges)).toBe(true);
        for (const edge of edges) {
            expect(typeof edge.source).toBe('string');
            expect(typeof edge.target).toBe('string');
            expect(typeof edge.type).toBe('string');
        }
    });

    it('nodeCount matches nodes written to disk', async () => {
        setup.writeKnowledge();

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        expect(result.nodeCount).toBe(nodes.length);
    });

    it('edgeCount matches edges written to disk', async () => {
        setup.writeKnowledge();

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );
        const edges = JSON.parse(edgesRaw) as GraphEdge[];

        expect(result.edgeCount).toBe(edges.length);
    });

    it('nodes are sorted by ID (idempotent output)', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        const ids = nodes.map((n) => n.id);
        const sortedIds = [...ids].sort();
        expect(ids).toEqual(sortedIds);
    });

    it('edges are sorted by source→target→type (idempotent output)', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );
        const edges = JSON.parse(edgesRaw) as GraphEdge[];

        const keys = edges.map((e) => `${e.source}→${e.target}→${e.type}`);
        const sortedKeys = [...keys].sort();
        expect(keys).toEqual(sortedKeys);
    });

    it('two identical runs produce identical output (idempotency)', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);
        const nodes1 = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const edges1 = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );

        await runGraphBuildPhase(setup.knowledgeRoot);
        const nodes2 = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const edges2 = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );

        expect(nodes1).toBe(nodes2);
        expect(edges1).toBe(edges2);
    });

    it('includes file nodes from summaries', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        const fileNodeIds = nodes.filter((n) => n.type === 'file').map((n) => n.id);
        expect(fileNodeIds.some((id) => id.includes('order.ts'))).toBe(true);
        expect(fileNodeIds.some((id) => id.includes('payment.ts'))).toBe(true);
    });

    it('includes symbol nodes', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        const symbolNodes = nodes.filter((n) => n.type === 'symbol');
        expect(symbolNodes.length).toBeGreaterThan(0);
        expect(symbolNodes.some((n) => n.id.includes('createOrder'))).toBe(true);
    });

    it('includes contains and calls edges', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );
        const edges = JSON.parse(edgesRaw) as GraphEdge[];

        const edgeTypes = new Set(edges.map((e) => e.type));
        expect(edgeTypes.has('contains')).toBe(true);
        expect(edgeTypes.has('calls')).toBe(true);
    });

    it('includes imports edges from fileDeps', async () => {
        setup.writeKnowledge();

        await runGraphBuildPhase(setup.knowledgeRoot);

        const edgesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'edges.json'), 'utf8'
        );
        const edges = JSON.parse(edgesRaw) as GraphEdge[];

        const importsEdges = edges.filter((e) => e.type === 'imports');
        expect(importsEdges.length).toBeGreaterThan(0);
    });

    it('handles missing symbols.json gracefully', async () => {
        setup.writeKnowledge({ symbols: undefined });

        // Only write deps and summaries (no symbols.json)
        fs.rmSync(path.join(setup.knowledgeRoot, 'symbols.json'));

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        // Should complete without throwing
        expect(typeof result.nodeCount).toBe('number');
        expect(typeof result.edgeCount).toBe('number');
    });

    it('handles empty symbols array', async () => {
        setup.writeKnowledge({ symbols: [] });

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        // Should still produce file/module nodes from summaries and deps
        expect(result.nodeCount).toBeGreaterThanOrEqual(0);
    });

    it('handles missing dependencies.json gracefully', async () => {
        setup.writeKnowledge();
        fs.rmSync(path.join(setup.knowledgeRoot, 'dependencies.json'));

        const result = await runGraphBuildPhase(setup.knowledgeRoot);

        expect(typeof result.nodeCount).toBe('number');
    });

    it('completes in under 5 seconds for typical input', async () => {
        setup.writeKnowledge();

        const start = Date.now();
        await runGraphBuildPhase(setup.knowledgeRoot);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(5000);
    });

    it('includes features in graph when features/index.json exists', async () => {
        setup.writeKnowledge();

        // Write features
        const featuresDir = path.join(setup.knowledgeRoot, 'features');
        fs.mkdirSync(featuresDir, { recursive: true });
        fs.writeFileSync(
            path.join(featuresDir, 'index.json'),
            JSON.stringify([
                {
                    id: 'cluster-0',
                    name: 'Order Processing',
                    description: 'Handles order creation and payment',
                    files: ['src/order.ts', 'src/payment.ts'],
                    entryPoints: ['createOrder'],
                    dataFlow: 'Cart → Order → Payment',
                    keySymbols: ['createOrder', 'charge'],
                    relatedFeatures: [],
                },
            ]),
            'utf8'
        );

        await runGraphBuildPhase(setup.knowledgeRoot);

        const nodesRaw = fs.readFileSync(
            path.join(setup.knowledgeRoot, 'graph', 'nodes.json'), 'utf8'
        );
        const nodes = JSON.parse(nodesRaw) as GraphNode[];

        const featureNodes = nodes.filter((n) => n.type === 'feature');
        expect(featureNodes.length).toBeGreaterThan(0);
        expect(featureNodes.some((n) => n.id.includes('cluster-0'))).toBe(true);
    });
});
