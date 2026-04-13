/**
 * Unit tests for KnowledgeGraph (mcp-server/tools/lib/knowledge-graph.ts).
 *
 * Covers:
 *   - buildKnowledgeGraph: node/edge construction from fixtures
 *   - traverseGraph: BFS with edge type filters, depth limits, direction
 *   - resolveStartNodes: ID resolution strategies
 *   - loadGraph: reads from disk, handles missing/malformed files
 *   - Performance: multi-hop traversal completes in <50ms (AC-024)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
    GraphNode,
    GraphEdge,
    KnowledgeGraphData,
    SymbolEntry,
    DependencyGraph,
    FileSummary,
    FeatureGroup,
} from '../src/types.js';
import {
    buildKnowledgeGraph,
    traverseGraph,
    loadGraph,
    resolveStartNodes,
    ALL_EDGE_TYPES,
} from '../mcp-server/tools/lib/knowledge-graph.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/project';

const sampleSymbols: SymbolEntry[] = [
    {
        name: 'createOrder',
        qualifiedName: 'OrderService.createOrder',
        file: '/project/src/order.ts',
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
        file: '/project/src/payment.ts',
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
        file: '/project/src/analytics.ts',
        line: 3,
        signature: 'function trackEvent(name: string): void',
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: ['OrderService.createOrder'],
        throws: [],
        isExported: true,
    },
];

const sampleDeps: DependencyGraph = {
    nodes: ['src', 'test'],
    edges: [{ from: 'test', to: 'src', type: 'direct' }],
    cycles: [],
    fileDeps: {
        'src/order.ts': ['src/payment.ts', 'src/analytics.ts'],
    },
};

const sampleSummaries: Record<string, FileSummary> = {
    'src/order.ts': {
        file: 'src/order.ts',
        purpose: 'Order management service',
        exports: ['createOrder'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: 'abc',
    },
    'src/payment.ts': {
        file: 'src/payment.ts',
        purpose: 'Payment processing service',
        exports: ['charge'],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: 'def',
    },
};

const sampleFeatures: FeatureGroup[] = [
    {
        id: 'payments',
        name: 'Payment Processing',
        description: 'Handles payment workflows',
        files: ['src/payment.ts', 'src/order.ts'],
        entryPoints: ['charge'],
        dataFlow: 'Order → Payment → Analytics',
        keySymbols: ['PaymentService.charge', 'OrderService.createOrder'],
        relatedFeatures: ['analytics'],
    },
    {
        id: 'analytics',
        name: 'Analytics Tracking',
        description: 'Tracks events',
        files: ['src/analytics.ts'],
        entryPoints: ['trackEvent'],
        dataFlow: 'Event → Buffer → Flush',
        keySymbols: ['AnalyticsService.trackEvent'],
        relatedFeatures: ['payments'],
    },
];

// ── buildKnowledgeGraph ───────────────────────────────────────────────────────

describe('buildKnowledgeGraph', () => {
    it('creates file nodes from summaries', () => {
        const graph = buildKnowledgeGraph([], sampleDeps, sampleSummaries, PROJECT_ROOT);
        const fileIds = graph.nodes.filter(n => n.type === 'file').map(n => n.id);
        expect(fileIds).toContain('file:src/order.ts');
        expect(fileIds).toContain('file:src/payment.ts');
    });

    it('creates symbol nodes from SymbolEntry array', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const symbolIds = graph.nodes.filter(n => n.type === 'symbol').map(n => n.id);
        expect(symbolIds).toContain('symbol:OrderService.createOrder');
        expect(symbolIds).toContain('symbol:PaymentService.charge');
        expect(symbolIds).toContain('symbol:AnalyticsService.trackEvent');
    });

    it('creates contains edges (file → symbol)', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const containsEdges = graph.edges.filter(e => e.type === 'contains');
        expect(containsEdges.length).toBeGreaterThan(0);

        const orderContains = containsEdges.find(e => e.target === 'symbol:OrderService.createOrder');
        expect(orderContains).toBeDefined();
        expect(orderContains!.source).toBe('file:src/order.ts');
    });

    it('creates calls edges (symbol → symbol) from SymbolEntry.calls', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const callsEdges = graph.edges.filter(e => e.type === 'calls');

        const orderCallsCharge = callsEdges.find(
            e => e.source === 'symbol:OrderService.createOrder' && e.target === 'symbol:PaymentService.charge'
        );
        expect(orderCallsCharge).toBeDefined();

        const orderCallsTrack = callsEdges.find(
            e => e.source === 'symbol:OrderService.createOrder' && e.target === 'symbol:AnalyticsService.trackEvent'
        );
        expect(orderCallsTrack).toBeDefined();
    });

    it('creates imports edges from DependencyGraph.fileDeps', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const importEdges = graph.edges.filter(e => e.type === 'imports');
        const orderImports = importEdges.filter(e => e.source === 'file:src/order.ts');
        expect(orderImports.map(e => e.target)).toContain('file:src/payment.ts');
        expect(orderImports.map(e => e.target)).toContain('file:src/analytics.ts');
    });

    it('creates module nodes and depends_on edges', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const moduleIds = graph.nodes.filter(n => n.type === 'module').map(n => n.id);
        expect(moduleIds).toContain('module:src');
        expect(moduleIds).toContain('module:test');

        const depsEdges = graph.edges.filter(e => e.type === 'depends_on');
        const testDepsSrc = depsEdges.find(e => e.source === 'module:test' && e.target === 'module:src');
        expect(testDepsSrc).toBeDefined();
    });

    it('creates feature nodes and similar_to edges', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT, sampleFeatures);
        const featureIds = graph.nodes.filter(n => n.type === 'feature').map(n => n.id);
        expect(featureIds).toContain('feature:payments');
        expect(featureIds).toContain('feature:analytics');

        const similarEdges = graph.edges.filter(e => e.type === 'similar_to');
        expect(similarEdges.length).toBeGreaterThan(0);
    });

    it('normalizes absolute paths to relative (strips projectRoot prefix)', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, {}, PROJECT_ROOT);
        const fileNodes = graph.nodes.filter(n => n.type === 'file');
        for (const n of fileNodes) {
            // Should not start with /project
            expect(n.id.startsWith('file:/project')).toBe(false);
        }
    });

    it('does not create duplicate file nodes', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        const orderFileNodes = graph.nodes.filter(n => n.id === 'file:src/order.ts');
        expect(orderFileNodes.length).toBe(1);
    });

    it('handles empty inputs gracefully', () => {
        const graph = buildKnowledgeGraph(
            [],
            { nodes: [], edges: [], cycles: [], fileDeps: {} },
            {},
            PROJECT_ROOT
        );
        expect(graph.nodes).toHaveLength(0);
        expect(graph.edges).toHaveLength(0);
    });
});

// ── traverseGraph ─────────────────────────────────────────────────────────────

describe('traverseGraph', () => {
    let graph: KnowledgeGraphData;

    beforeAll(() => {
        graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT, sampleFeatures);
    });

    it('returns start node at depth 0', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', [...ALL_EDGE_TYPES], 1, 'outgoing');
        const startNode = result.nodes.find(n => n.id === 'symbol:OrderService.createOrder');
        expect(startNode).toBeDefined();
        expect(startNode!.depth).toBe(0);
    });

    it('returns empty result for unknown start node', () => {
        const result = traverseGraph(graph, 'symbol:nonExistent', [...ALL_EDGE_TYPES], 2, 'outgoing');
        expect(result.nodes).toHaveLength(0);
        expect(result.edges).toHaveLength(0);
    });

    it('follows outgoing calls edges from createOrder', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', ['calls'], 1, 'outgoing');
        const ids = result.nodes.map(n => n.id);
        expect(ids).toContain('symbol:PaymentService.charge');
        expect(ids).toContain('symbol:AnalyticsService.trackEvent');
    });

    it('follows incoming calls edges (who calls charge)', () => {
        const result = traverseGraph(graph, 'symbol:PaymentService.charge', ['calls'], 1, 'incoming');
        const ids = result.nodes.map(n => n.id);
        expect(ids).toContain('symbol:OrderService.createOrder');
    });

    it('follows both directions', () => {
        const result = traverseGraph(graph, 'symbol:PaymentService.charge', ['calls', 'contains'], 2, 'both');
        const ids = result.nodes.map(n => n.id);
        expect(ids).toContain('symbol:OrderService.createOrder');
        expect(ids).toContain('file:src/payment.ts');
    });

    it('respects maxDepth limit', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', ['calls', 'contains'], 1, 'outgoing');
        const maxDepth = Math.max(...result.nodes.map(n => n.depth));
        expect(maxDepth).toBeLessThanOrEqual(1);
    });

    it('annotates nodes with correct depth values', () => {
        const result = traverseGraph(graph, 'file:src/order.ts', ['contains', 'calls'], 2, 'outgoing');
        const createOrderNode = result.nodes.find(n => n.id === 'symbol:OrderService.createOrder');
        expect(createOrderNode).toBeDefined();
        expect(createOrderNode!.depth).toBe(1);
    });

    it('filters to specific edge types', () => {
        // file node has no 'calls' outgoing edges, only contains/imports
        const result = traverseGraph(graph, 'file:src/order.ts', ['calls'], 2, 'outgoing');
        const ids = result.nodes.map(n => n.id);
        expect(ids).toHaveLength(1); // only start node
    });

    it('handles cycles without infinite loops', () => {
        const cyclicGraph: KnowledgeGraphData = {
            nodes: [
                { id: 'symbol:A', type: 'symbol', metadata: { name: 'A' } },
                { id: 'symbol:B', type: 'symbol', metadata: { name: 'B' } },
            ],
            edges: [
                { source: 'symbol:A', target: 'symbol:B', type: 'calls' },
                { source: 'symbol:B', target: 'symbol:A', type: 'calls' },
            ],
        };
        const result = traverseGraph(cyclicGraph, 'symbol:A', ['calls'], 5, 'outgoing');
        expect(result.nodes.length).toBe(2); // A and B — no duplicates
    });

    it('does not include duplicate nodes', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', [...ALL_EDGE_TYPES], 3, 'both');
        const ids = result.nodes.map(n => n.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('does not include duplicate edges', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', [...ALL_EDGE_TYPES], 3, 'both');
        const edgeKeys = result.edges.map(e => `${e.source}→${e.target}→${e.type}`);
        expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
    });

    it('returns traversed edges with correct types', () => {
        const result = traverseGraph(graph, 'symbol:OrderService.createOrder', ['calls'], 1, 'outgoing');
        for (const edge of result.edges) {
            expect(edge.type).toBe('calls');
        }
    });

    it('AC-024: multi-hop traversal with maxDepth=3 completes in <50ms', () => {
        const start = Date.now();
        traverseGraph(graph, 'symbol:OrderService.createOrder', [...ALL_EDGE_TYPES], 3, 'both');
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(50);
    });
});

// ── resolveStartNodes ─────────────────────────────────────────────────────────

describe('resolveStartNodes', () => {
    let graph: KnowledgeGraphData;

    beforeAll(() => {
        graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT, sampleFeatures);
    });

    it('resolves exact node ID', () => {
        const matches = resolveStartNodes(graph, 'symbol:OrderService.createOrder');
        expect(matches).toContain('symbol:OrderService.createOrder');
    });

    it('resolves by adding "symbol:" prefix', () => {
        const matches = resolveStartNodes(graph, 'OrderService.createOrder');
        expect(matches).toContain('symbol:OrderService.createOrder');
    });

    it('resolves by adding "file:" prefix', () => {
        const matches = resolveStartNodes(graph, 'src/order.ts');
        expect(matches).toContain('file:src/order.ts');
    });

    it('resolves by adding "module:" prefix', () => {
        const matches = resolveStartNodes(graph, 'src');
        expect(matches).toContain('module:src');
    });

    it('resolves file by suffix (basename)', () => {
        const matches = resolveStartNodes(graph, 'order.ts');
        expect(matches.some(id => id.includes('order.ts'))).toBe(true);
    });

    it('resolves symbol by case-insensitive name', () => {
        const matches = resolveStartNodes(graph, 'CREATEORDER');
        expect(matches).toContain('symbol:OrderService.createOrder');
    });

    it('returns empty array for completely unknown node', () => {
        const matches = resolveStartNodes(graph, 'symbol:doesNotExistAtAll12345');
        expect(matches).toHaveLength(0);
    });
});

// ── loadGraph ─────────────────────────────────────────────────────────────────

describe('loadGraph', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-load-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when graph directory does not exist', () => {
        expect(loadGraph(tmpDir)).toBeNull();
    });

    it('loads graph from disk when nodes.json and edges.json exist', () => {
        const graphDir = path.join(tmpDir, 'graph');
        fs.mkdirSync(graphDir, { recursive: true });

        const testGraph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, PROJECT_ROOT);
        fs.writeFileSync(path.join(graphDir, 'nodes.json'), JSON.stringify(testGraph.nodes));
        fs.writeFileSync(path.join(graphDir, 'edges.json'), JSON.stringify(testGraph.edges));

        const loaded = loadGraph(tmpDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.nodes.length).toBe(testGraph.nodes.length);
        expect(loaded!.edges.length).toBe(testGraph.edges.length);
    });

    it('returns null when nodes.json is malformed JSON', () => {
        const graphDir2 = path.join(tmpDir, 'graph2');
        fs.mkdirSync(graphDir2, { recursive: true });
        fs.writeFileSync(path.join(graphDir2, 'nodes.json'), '{invalid json', 'utf8');
        fs.writeFileSync(path.join(graphDir2, 'edges.json'), '[]', 'utf8');
        expect(loadGraph(graphDir2)).toBeNull();
    });
});

// ── ALL_EDGE_TYPES constant ───────────────────────────────────────────────────

describe('ALL_EDGE_TYPES', () => {
    it('contains all 6 edge types from architecture', () => {
        const expected = ['contains', 'calls', 'imports', 'depends_on', 'implements', 'similar_to'];
        for (const type of expected) {
            expect(ALL_EDGE_TYPES).toContain(type);
        }
        expect(ALL_EDGE_TYPES.length).toBe(6);
    });
});
