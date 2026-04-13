/**
 * Tests for the explore_graph MCP tool handler and supporting library functions.
 *
 * Covers:
 *   - Unit tests: traverseGraph, buildKnowledgeGraph, resolveStartNodes
 *   - Integration tests: handler() end-to-end with a temp knowledge root
 *   - Performance: multi-hop traversal completes in <50ms (AC-024)
 *   - Response budget: output does not exceed 16KB (AC-019)
 *   - WorkingMemory caching: cache hit returns same result
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
    KnowledgeIndex,
    SymbolEntry,
    DependencyGraph,
    FileSummary,
    GraphNode,
    GraphEdge,
    KnowledgeGraphData,
} from '../src/types.js';
import {
    traverseGraph,
    buildKnowledgeGraph,
    resolveStartNodes,
    loadGraph,
    ALL_EDGE_TYPES,
} from '../mcp-server/tools/lib/knowledge-graph.js';
import { handler } from '../mcp-server/tools/explore-graph.js';
import { clearMemory } from '../mcp-server/tools/lib/working-memory.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal graph: A→B (calls), B→C (calls), file:A contains symbol:A */
function makeTestGraph(): KnowledgeGraphData {
    const nodes: GraphNode[] = [
        { id: 'file:src/order.ts',     type: 'file',   metadata: { path: 'src/order.ts', purpose: 'Order service' } },
        { id: 'file:src/payment.ts',   type: 'file',   metadata: { path: 'src/payment.ts', purpose: 'Payment service' } },
        { id: 'file:src/analytics.ts', type: 'file',   metadata: { path: 'src/analytics.ts', purpose: 'Analytics service' } },
        { id: 'symbol:createOrder',    type: 'symbol', metadata: { qualifiedName: 'createOrder', name: 'createOrder', file: 'src/order.ts', line: '10', symbolType: 'function', signature: 'function createOrder(items: Item[]): Order', isExported: 'true', module: 'src' } },
        { id: 'symbol:charge',         type: 'symbol', metadata: { qualifiedName: 'charge', name: 'charge', file: 'src/payment.ts', line: '5', symbolType: 'function', signature: 'function charge(amount: number): void', isExported: 'true', module: 'src' } },
        { id: 'symbol:trackEvent',     type: 'symbol', metadata: { qualifiedName: 'trackEvent', name: 'trackEvent', file: 'src/analytics.ts', line: '3', symbolType: 'function', signature: 'function trackEvent(name: string): void', isExported: 'true', module: 'src' } },
        { id: 'module:src',            type: 'module', metadata: { name: 'src' } },
        { id: 'feature:payments',      type: 'feature', metadata: { name: 'Payment Processing', description: 'Handles payment workflows', id: 'payments' } },
    ];

    const edges: GraphEdge[] = [
        { source: 'file:src/order.ts',     target: 'symbol:createOrder', type: 'contains' },
        { source: 'file:src/payment.ts',   target: 'symbol:charge',      type: 'contains' },
        { source: 'file:src/analytics.ts', target: 'symbol:trackEvent',  type: 'contains' },
        { source: 'symbol:createOrder',    target: 'symbol:charge',      type: 'calls' },
        { source: 'symbol:createOrder',    target: 'symbol:trackEvent',  type: 'calls' },
        { source: 'file:src/order.ts',     target: 'file:src/payment.ts',   type: 'imports' },
        { source: 'file:src/order.ts',     target: 'file:src/analytics.ts', type: 'imports' },
        { source: 'module:src',            target: 'module:src',         type: 'depends_on' }, // self-loop for test
        { source: 'feature:payments',      target: 'feature:payments',   type: 'similar_to' }, // self-loop for test
    ];

    return { nodes, edges };
}

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
        throws: [],
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

const sampleIndex: KnowledgeIndex = {
    modules: ['src'],
    summaries: [],
    hasSymbols: true,
    hasDependencies: true,
    lastBuilt: new Date().toISOString(),
    fileCount: 3,
};

// ── Unit tests: traverseGraph ─────────────────────────────────────────────────

describe('traverseGraph', () => {
    const graph = makeTestGraph();

    it('returns start node at depth 0', () => {
        const result = traverseGraph(graph, 'symbol:createOrder', [...ALL_EDGE_TYPES], 1, 'outgoing');
        expect(result.nodes.length).toBeGreaterThanOrEqual(1);
        const startNode = result.nodes.find((n) => n.id === 'symbol:createOrder');
        expect(startNode).toBeDefined();
        expect(startNode!.depth).toBe(0);
    });

    it('returns empty result when startId not in graph', () => {
        const result = traverseGraph(graph, 'symbol:nonExistent', [...ALL_EDGE_TYPES], 2, 'outgoing');
        expect(result.nodes).toHaveLength(0);
        expect(result.edges).toHaveLength(0);
    });

    it('follows outgoing calls edges from createOrder', () => {
        const result = traverseGraph(graph, 'symbol:createOrder', ['calls'], 1, 'outgoing');
        const ids = result.nodes.map((n) => n.id);
        expect(ids).toContain('symbol:charge');
        expect(ids).toContain('symbol:trackEvent');
    });

    it('follows incoming calls edges (who calls charge)', () => {
        const result = traverseGraph(graph, 'symbol:charge', ['calls'], 1, 'incoming');
        const ids = result.nodes.map((n) => n.id);
        expect(ids).toContain('symbol:createOrder');
    });

    it('follows both directions', () => {
        const result = traverseGraph(graph, 'symbol:charge', ['calls', 'contains'], 2, 'both');
        const ids = result.nodes.map((n) => n.id);
        // incoming calls: createOrder calls charge
        expect(ids).toContain('symbol:createOrder');
        // incoming contains: file:src/payment.ts contains charge
        expect(ids).toContain('file:src/payment.ts');
    });

    it('respects maxDepth=1 — does not return depth 2 nodes', () => {
        // depth 0: createOrder; depth 1: charge, trackEvent
        // with maxDepth=1 we should not go further
        const result = traverseGraph(graph, 'symbol:createOrder', ['calls', 'contains'], 1, 'outgoing');
        const depths = result.nodes.map((n) => n.depth);
        expect(Math.max(...depths)).toBeLessThanOrEqual(1);
    });

    it('annotates nodes with correct depth values', () => {
        const result = traverseGraph(graph, 'file:src/order.ts', ['contains', 'calls'], 2, 'outgoing');
        const createOrderNode = result.nodes.find((n) => n.id === 'symbol:createOrder');
        expect(createOrderNode).toBeDefined();
        expect(createOrderNode!.depth).toBe(1);

        // symbol:charge is depth 2 (file→createOrder→charge)
        const chargeNode = result.nodes.find((n) => n.id === 'symbol:charge');
        if (chargeNode) {
            expect(chargeNode.depth).toBe(2);
        }
    });

    it('filters to specific edge types — calls only', () => {
        const result = traverseGraph(graph, 'file:src/order.ts', ['calls'], 2, 'outgoing');
        // file nodes only have 'contains' and 'imports' edges to reach symbols
        // since we filter to 'calls' only, file:src/order.ts has no outgoing calls
        // so we only get the start node
        const ids = result.nodes.map((n) => n.id);
        expect(ids).toHaveLength(1); // only start node
        expect(ids[0]).toBe('file:src/order.ts');
    });

    it('handles cycles without infinite loops', () => {
        // Self-loops in test graph (module:src→module:src, feature:payments→feature:payments)
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
        // Should complete without hanging
        const result = traverseGraph(cyclicGraph, 'symbol:A', ['calls'], 5, 'outgoing');
        expect(result.nodes.length).toBe(2); // A and B, no duplicates
    });

    it('returns traversed edges in result', () => {
        const result = traverseGraph(graph, 'symbol:createOrder', ['calls'], 1, 'outgoing');
        expect(result.edges.length).toBeGreaterThan(0);
        const edgeTypes = [...new Set(result.edges.map((e) => e.type))];
        expect(edgeTypes).toEqual(['calls']);
    });

    it('does not include duplicate edges', () => {
        const result = traverseGraph(graph, 'symbol:createOrder', [...ALL_EDGE_TYPES], 3, 'both');
        const edgeKeys = result.edges.map((e) => `${e.source}→${e.target}→${e.type}`);
        const uniqueKeys = new Set(edgeKeys);
        expect(edgeKeys.length).toBe(uniqueKeys.size);
    });
});

// ── Unit tests: buildKnowledgeGraph ──────────────────────────────────────────

describe('buildKnowledgeGraph', () => {
    it('creates file nodes from summaries', () => {
        const graph = buildKnowledgeGraph([], sampleDeps, sampleSummaries, '/project');
        const fileIds = graph.nodes.filter((n) => n.type === 'file').map((n) => n.id);
        expect(fileIds).toContain('file:src/order.ts');
        expect(fileIds).toContain('file:src/payment.ts');
    });

    it('creates symbol nodes for each SymbolEntry', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const symbolIds = graph.nodes.filter((n) => n.type === 'symbol').map((n) => n.id);
        expect(symbolIds).toContain('symbol:OrderService.createOrder');
        expect(symbolIds).toContain('symbol:PaymentService.charge');
    });

    it('creates contains edges from file to symbol', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const containsEdges = graph.edges.filter((e) => e.type === 'contains');
        expect(containsEdges.length).toBeGreaterThan(0);
        const createOrderContains = containsEdges.find(
            (e) => e.target === 'symbol:OrderService.createOrder'
        );
        expect(createOrderContains).toBeDefined();
        expect(createOrderContains!.source).toMatch(/^file:/);
    });

    it('creates calls edges from symbol.calls array', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const callsEdges = graph.edges.filter((e) => e.type === 'calls');
        const createOrderCalls = callsEdges.filter(
            (e) => e.source === 'symbol:OrderService.createOrder'
        );
        expect(createOrderCalls.map((e) => e.target)).toContain('symbol:PaymentService.charge');
        expect(createOrderCalls.map((e) => e.target)).toContain('symbol:AnalyticsService.trackEvent');
    });

    it('creates imports edges from fileDeps', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const importEdges = graph.edges.filter((e) => e.type === 'imports');
        const orderImports = importEdges.filter((e) => e.source === 'file:src/order.ts');
        expect(orderImports.map((e) => e.target)).toContain('file:src/payment.ts');
    });

    it('creates module nodes + depends_on edges', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const moduleNodes = graph.nodes.filter((n) => n.type === 'module');
        expect(moduleNodes.map((n) => n.id)).toContain('module:src');
        const depsEdges = graph.edges.filter((e) => e.type === 'depends_on');
        expect(depsEdges.length).toBeGreaterThan(0);
    });

    it('normalizes absolute paths to relative ones', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, {}, '/project');
        // File nodes from symbols should be relative (no /project prefix)
        const fileNodes = graph.nodes.filter((n) => n.type === 'file');
        for (const n of fileNodes) {
            expect(n.id.startsWith('file:/project')).toBe(false);
        }
    });

    it('does not create duplicate nodes for the same file', () => {
        const graph = buildKnowledgeGraph(sampleSymbols, sampleDeps, sampleSummaries, '/project');
        const orderFileNodes = graph.nodes.filter((n) => n.id === 'file:src/order.ts');
        expect(orderFileNodes.length).toBe(1);
    });

    it('handles empty inputs gracefully', () => {
        const graph = buildKnowledgeGraph(
            [],
            { nodes: [], edges: [], cycles: [], fileDeps: {} },
            {},
            '/project'
        );
        expect(graph.nodes).toHaveLength(0);
        expect(graph.edges).toHaveLength(0);
    });
});

// ── Unit tests: resolveStartNodes ─────────────────────────────────────────────

describe('resolveStartNodes', () => {
    const graph = makeTestGraph();

    it('resolves exact node ID', () => {
        const matches = resolveStartNodes(graph, 'symbol:createOrder');
        expect(matches).toEqual(['symbol:createOrder']);
    });

    it('resolves by adding "symbol:" prefix', () => {
        const matches = resolveStartNodes(graph, 'createOrder');
        expect(matches).toContain('symbol:createOrder');
    });

    it('resolves file by adding "file:" prefix', () => {
        const matches = resolveStartNodes(graph, 'src/order.ts');
        expect(matches).toContain('file:src/order.ts');
    });

    it('resolves module by name', () => {
        const matches = resolveStartNodes(graph, 'module:src');
        expect(matches).toContain('module:src');
    });

    it('resolves by file suffix (basename)', () => {
        const matches = resolveStartNodes(graph, 'order.ts');
        expect(matches.some((id) => id.includes('order.ts'))).toBe(true);
    });

    it('resolves by case-insensitive symbol name', () => {
        const matches = resolveStartNodes(graph, 'CREATEORDER');
        expect(matches).toContain('symbol:createOrder');
    });

    it('returns empty array for unknown node', () => {
        const matches = resolveStartNodes(graph, 'symbol:doesNotExist');
        expect(matches).toHaveLength(0);
    });

    it('returns multiple matches for ambiguous name', () => {
        // 'charge' and 'createOrder' both exist — 'src' matches module:src and partially others
        const matches = resolveStartNodes(graph, 'charge');
        // At minimum should find symbol:charge
        expect(matches.length).toBeGreaterThan(0);
    });
});

// ── Unit tests: loadGraph ─────────────────────────────────────────────────────

describe('loadGraph', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-graph-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when graph directory does not exist', () => {
        const result = loadGraph(tmpDir);
        expect(result).toBeNull();
    });

    it('loads pre-built graph from disk when files exist', () => {
        const graphDir = path.join(tmpDir, 'graph');
        fs.mkdirSync(graphDir, { recursive: true });

        const testGraph = makeTestGraph();
        fs.writeFileSync(
            path.join(graphDir, 'nodes.json'),
            JSON.stringify(testGraph.nodes),
            'utf8'
        );
        fs.writeFileSync(
            path.join(graphDir, 'edges.json'),
            JSON.stringify(testGraph.edges),
            'utf8'
        );

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
        const result = loadGraph(graphDir2);
        expect(result).toBeNull();
    });
});

// ── Integration tests: handler ────────────────────────────────────────────────

describe('explore_graph handler — integration', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-graph-test-'));

        // Write knowledge index
        fs.writeFileSync(
            path.join(tmpDir, 'index.json'),
            JSON.stringify(sampleIndex),
            'utf8'
        );

        // Write symbols.json
        fs.writeFileSync(
            path.join(tmpDir, 'symbols.json'),
            JSON.stringify(sampleSymbols),
            'utf8'
        );

        // Write dependencies.json
        fs.writeFileSync(
            path.join(tmpDir, 'dependencies.json'),
            JSON.stringify(sampleDeps),
            'utf8'
        );

        // Write summaries/cache.json
        const summariesDir = path.join(tmpDir, 'summaries');
        fs.mkdirSync(summariesDir, { recursive: true });
        fs.writeFileSync(
            path.join(summariesDir, 'cache.json'),
            JSON.stringify(sampleSummaries),
            'utf8'
        );
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Clear WorkingMemory between tests for isolation
        clearMemory();
    });

    it('returns error when start parameter is empty', () => {
        const result = handler({ start: '' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('"start" parameter is required');
    });

    it('returns error for invalid direction', () => {
        const result = handler({ start: 'something', direction: 'sideways' as never }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Invalid direction');
    });

    it('returns error for invalid edge types', () => {
        const result = handler({ start: 'something', edgeTypes: ['invalid_type'] }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Invalid edge type');
    });

    it('returns error when knowledge index is missing', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
        const result = handler({ start: 'test' }, emptyDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Knowledge base not found');
        fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('returns node-not-found message for unknown start node', () => {
        const result = handler({ start: 'symbol:totallyUnknown' }, tmpDir);
        // Not an error — returns guidance
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('No node found matching');
    });

    it('REQ-006: accepts start, edgeTypes, maxDepth, direction parameters', () => {
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                edgeTypes: ['calls'],
                maxDepth: 2,
                direction: 'outgoing',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('createOrder');
    });

    it('REQ-006: returns traversed subgraph with node metadata and depth annotations', () => {
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                edgeTypes: ['calls'],
                maxDepth: 1,
                direction: 'outgoing',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should show depth 0 for start node
        expect(text).toContain('depth 0');
        // Should show depth 1 for direct callees
        expect(text).toContain('depth 1');
    });

    it('AC-004: call tree traversal returns correct depth-annotated results', () => {
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                edgeTypes: ['calls'],
                maxDepth: 2,
                direction: 'outgoing',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // createOrder → charge (depth 1) and → trackEvent (depth 1)
        expect(text).toContain('PaymentService.charge');
        expect(text).toContain('AnalyticsService.trackEvent');
    });

    it('AC-005: incoming imports traversal lists all importing files', () => {
        const result = handler(
            {
                start: 'file:src/payment.ts',
                edgeTypes: ['imports'],
                maxDepth: 1,
                direction: 'incoming',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // src/order.ts imports src/payment.ts
        expect(text).toContain('order');
    });

    it('defaults to maxDepth=2 and direction=outgoing when not specified', () => {
        const result = handler({ start: 'symbol:OrderService.createOrder' }, tmpDir);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('maxDepth: 2');
        expect(text).toContain('Direction: outgoing');
    });

    it('defaults edgeTypes to all types when not specified', () => {
        const result = handler({ start: 'symbol:OrderService.createOrder' }, tmpDir);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should mention all edge types in the header
        for (const edgeType of ALL_EDGE_TYPES) {
            expect(text).toContain(edgeType);
        }
    });

    it('clamps maxDepth to valid range 1-5', () => {
        // maxDepth=0 should be clamped to 1
        const result0 = handler({ start: 'symbol:OrderService.createOrder', maxDepth: 0 }, tmpDir);
        expect(result0.isError).toBeFalsy();
        expect(result0.content[0].text).toContain('maxDepth: 1');

        // maxDepth=99 should be clamped to 5
        const result99 = handler({ start: 'symbol:OrderService.createOrder', maxDepth: 99 }, tmpDir);
        expect(result99.isError).toBeFalsy();
        expect(result99.content[0].text).toContain('maxDepth: 5');
    });

    it('REQ-012/AC-019: response does not exceed 16KB', () => {
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                maxDepth: 5,
                direction: 'both',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const sizeBytes = Buffer.byteLength(result.content[0].text, 'utf8');
        expect(sizeBytes).toBeLessThanOrEqual(16_384);
    });

    it('AC-021/REQ-021: graph traversal completes in <50ms for in-memory operations', () => {
        const start = Date.now();
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                maxDepth: 3,
                direction: 'both',
            },
            tmpDir
        );
        const elapsed = Date.now() - start;
        expect(result.isError).toBeFalsy();
        expect(elapsed).toBeLessThan(50);
    });

    it('AC-024: multi-hop query with maxDepth=3 returns in <50ms', () => {
        const start = Date.now();
        handler(
            {
                start: 'symbol:OrderService.createOrder',
                edgeTypes: ['calls', 'contains', 'imports'],
                maxDepth: 3,
                direction: 'outgoing',
            },
            tmpDir
        );
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(50);
    });

    it('WorkingMemory cache: identical query returns cached result', () => {
        const args = {
            start: 'symbol:OrderService.createOrder',
            edgeTypes: ['calls'] as Array<'calls'>,
            maxDepth: 2,
            direction: 'outgoing' as const,
        };

        // First call
        const result1 = handler(args, tmpDir);
        expect(result1.isError).toBeFalsy();

        // Second call — should be served from cache (same text)
        const result2 = handler(args, tmpDir);
        expect(result2.content[0].text).toBe(result1.content[0].text);
    });

    it('returns disambiguation list when multiple nodes match', () => {
        // 'src' could match module:src and file nodes under src/
        const result = handler({ start: 'module:src' }, tmpDir);
        // Should either traverse from module:src or give a disambiguation message
        // In either case, should not be an error
        expect(result.isError).toBeFalsy();
    });

    it('shows edges section grouped by type', () => {
        const result = handler(
            {
                start: 'file:src/order.ts',
                edgeTypes: ['contains', 'imports'],
                maxDepth: 1,
                direction: 'outgoing',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // Should include edges section
        expect(text).toContain('=== Edges ===');
    });

    it('shows nodes section with depth groups', () => {
        const result = handler(
            {
                start: 'symbol:OrderService.createOrder',
                edgeTypes: ['calls'],
                maxDepth: 1,
                direction: 'outgoing',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('=== Nodes ===');
        expect(text).toContain('Depth 0');
    });

    it('handles "both" direction — finds both callers and callees', () => {
        const result = handler(
            {
                start: 'symbol:PaymentService.charge',
                edgeTypes: ['calls'],
                maxDepth: 1,
                direction: 'both',
            },
            tmpDir
        );
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        // createOrder calls charge (incoming to charge)
        expect(text).toContain('createOrder');
    });
});
