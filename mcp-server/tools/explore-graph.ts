/**
 * explore_graph MCP tool — traverses the knowledge graph from a start node.
 *
 * Flow:
 *  1. Parse and validate args (start required; edgeTypes, maxDepth, direction with defaults)
 *  2. Load KnowledgeIndex (required for WorkingMemory cache key)
 *  3. Check WorkingMemory cache → return cached result if hit
 *  4. Load KnowledgeGraph via data-loader (pre-built or dynamically constructed)
 *  5. If graph unavailable, return error with guidance
 *  6. Resolve start node ID from user input
 *  7. Call traverseGraph() with parameters
 *  8. Format result: nodes with depth/type, edges with types
 *  9. Cache result in WorkingMemory
 * 10. Build response via buildResponse() respecting 16 KB budget
 */

import type { CallToolResult, ExploreGraphArgs, GraphNode, GraphEdge } from '../types.js';
import { loadIndex, loadKnowledgeGraph } from './lib/data-loader.js';
import { buildResponse, type Section } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';
import { resolveProjectRoot } from './lib/path-utils.js';
import { getFromMemory, setInMemory } from './lib/working-memory.js';
import {
    traverseGraph,
    resolveStartNodes,
    ALL_EDGE_TYPES,
} from './lib/knowledge-graph.js';

export type { ExploreGraphArgs };

const TOOL_BUDGET = 16_000; // 16 KB per REQ-012 / AC-019
const VALID_DIRECTIONS = ['outgoing', 'incoming', 'both'] as const;

/** Build a deterministic WorkingMemory cache key for this tool. */
function buildCacheKey(
    knowledgeRoot: string,
    start: string,
    edgeTypes: string[],
    maxDepth: number,
    direction: string
): string {
    const sortedEdgeTypes = [...edgeTypes].sort().join(',');
    return `explore_graph:${knowledgeRoot}:${start}:${sortedEdgeTypes}:${maxDepth}:${direction}`;
}

/** Node type icon/label for display. */
function nodeTypeLabel(type: GraphNode['type']): string {
    switch (type) {
        case 'file':    return '📄 file';
        case 'symbol':  return '🔷 symbol';
        case 'module':  return '📦 module';
        case 'feature': return '✨ feature';
        case 'package': return '📎 package';
        default:        return type;
    }
}

/** Edge type label for display. */
function edgeTypeLabel(type: GraphEdge['type']): string {
    switch (type) {
        case 'contains':    return '⊃ contains';
        case 'calls':       return '→ calls';
        case 'imports':     return '⬅ imports';
        case 'depends_on':  return '⟶ depends_on';
        case 'implements':  return '⊑ implements';
        case 'similar_to':  return '≈ similar_to';
        default:            return type;
    }
}

/**
 * Format a single traversed node for text output.
 * Shows depth as indentation, type label, ID, and key metadata.
 */
function formatNode(node: GraphNode & { depth: number }): string {
    const indent = '  '.repeat(node.depth);
    const typeStr = nodeTypeLabel(node.type);
    const id = node.id;

    // Surface most useful metadata field based on type
    let detail = '';
    if (node.type === 'symbol') {
        const sig = node.metadata['signature'];
        if (sig) detail = ` — ${sig.slice(0, 120)}`;
    } else if (node.type === 'file') {
        const purpose = node.metadata['purpose'];
        if (purpose) detail = ` — ${purpose.slice(0, 100)}`;
    } else if (node.type === 'feature') {
        const desc = node.metadata['description'];
        if (desc) detail = ` — ${desc.slice(0, 100)}`;
    } else if (node.type === 'module') {
        // nothing extra
    }

    return `${indent}[depth ${node.depth}] ${typeStr}: ${id}${detail}`;
}

/**
 * Format an edge for text output.
 */
function formatEdge(edge: GraphEdge): string {
    return `  ${edge.source}  --[${edgeTypeLabel(edge.type)}]-->  ${edge.target}`;
}

/**
 * Handler for the explore_graph MCP tool.
 *
 * Traverses the knowledge graph starting from a given node ID, respecting
 * edgeType filters, depth limits, and traversal direction.
 *
 * @param args          ExploreGraphArgs (start required; others optional with defaults)
 * @param knowledgeRoot Path to .knowledge/ directory (defaults to env/'.knowledge')
 */
export function handler(
    args: ExploreGraphArgs,
    knowledgeRoot: string = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge'
): CallToolResult {
    // ── 1. Parse and validate arguments ────────────────────────────────────
    const start = (args.start ?? '').trim();
    if (!start) {
        return {
            content: [{ type: 'text', text: '"start" parameter is required and must not be empty.' }],
            isError: true,
        };
    }

    // Validate direction
    const directionInput = args.direction ?? 'outgoing';
    if (!VALID_DIRECTIONS.includes(directionInput as (typeof VALID_DIRECTIONS)[number])) {
        return {
            content: [{
                type: 'text',
                text: `Invalid direction "${directionInput}". Valid values: ${VALID_DIRECTIONS.join(', ')}.`,
            }],
            isError: true,
        };
    }
    const direction = directionInput as 'outgoing' | 'incoming' | 'both';

    // Validate maxDepth (clamp to 1-5)
    const rawDepth = args.maxDepth ?? 2;
    const maxDepth = Math.max(1, Math.min(5, Math.round(rawDepth)));

    // Validate edgeTypes — fall back to all when omitted or empty
    const validEdgeSet = new Set(ALL_EDGE_TYPES as ReadonlyArray<string>);
    const requestedEdgeTypes = args.edgeTypes && args.edgeTypes.length > 0
        ? args.edgeTypes
        : [...ALL_EDGE_TYPES];

    const invalidEdgeTypes = requestedEdgeTypes.filter((t) => !validEdgeSet.has(t));
    if (invalidEdgeTypes.length > 0) {
        return {
            content: [{
                type: 'text',
                text: [
                    `Invalid edge type(s): ${invalidEdgeTypes.join(', ')}.`,
                    `Valid edge types: ${[...ALL_EDGE_TYPES].join(', ')}.`,
                ].join('\n'),
            }],
            isError: true,
        };
    }
    const edgeTypes = requestedEdgeTypes;

    // ── 2. Load KnowledgeIndex for cache key ────────────────────────────────
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);

    if (!index) {
        return {
            content: [{
                type: 'text',
                text: [
                    'Knowledge base not found. The knowledge index has not been built yet for this project.',
                    '',
                    'Run the build pipeline to generate the knowledge index:',
                    '  npm run build-knowledge',
                ].join('\n'),
            }],
            isError: true,
        };
    }

    // ── 3. Check WorkingMemory cache ────────────────────────────────────────
    const cacheKey = buildCacheKey(knowledgeRoot, start, edgeTypes, maxDepth, direction);
    const cached = getFromMemory<string>(cacheKey, index.lastBuilt);
    if (cached !== undefined) {
        return { content: [{ type: 'text', text: cached }] };
    }

    // ── 4. Load KnowledgeGraph ──────────────────────────────────────────────
    const graph = loadKnowledgeGraph(knowledgeRoot);

    if (!graph || graph.nodes.length === 0) {
        return {
            content: [{
                type: 'text',
                text: [
                    'Knowledge graph is not available.',
                    '',
                    'The graph can be generated in two ways:',
                    '  1. Run the full build pipeline (Phase 8 produces graph/nodes.json + graph/edges.json):',
                    '       npm run build-knowledge',
                    '  2. Ensure at least symbols.json or dependencies.json exists under .knowledge/',
                    '     (the graph will be built dynamically from these artifacts).',
                ].join('\n'),
            }],
            isError: true,
        };
    }

    // ── 5. Resolve start node ───────────────────────────────────────────────
    const startNodeIds = resolveStartNodes(graph, start);

    if (startNodeIds.length === 0) {
        // Provide helpful suggestions
        const sampleIds = graph.nodes
            .slice(0, 10)
            .map((n) => `  ${n.id}`)
            .join('\n');

        return {
            content: [{
                type: 'text',
                text: [
                    `No node found matching "${start}" in the knowledge graph.`,
                    '',
                    'Node IDs follow the format:',
                    '  file:<relativePath>       e.g. file:tools/lib/cache.ts',
                    '  symbol:<qualifiedName>    e.g. symbol:OrderService.createOrder',
                    '  module:<name>             e.g. module:tools',
                    '  feature:<id>              e.g. feature:auth',
                    '',
                    `Sample node IDs in this graph (${graph.nodes.length} total):`,
                    sampleIds,
                    '',
                    'Tip: use get_project_overview() or find_symbol() to discover node IDs.',
                ].join('\n'),
            }],
        };
    }

    if (startNodeIds.length > 1) {
        // Disambiguation required — show all matches
        const matchList = startNodeIds.map((id) => `  ${id}`).join('\n');
        return {
            content: [{
                type: 'text',
                text: [
                    `"${start}" matches ${startNodeIds.length} nodes. Use the full node ID:`,
                    '',
                    matchList,
                    '',
                    `Example: explore_graph(start="${startNodeIds[0]}")`,
                ].join('\n'),
            }],
        };
    }

    const startId = startNodeIds[0]!;

    // ── 6. Traverse the graph ───────────────────────────────────────────────
    const traversalStart = Date.now();
    const result = traverseGraph(graph, startId, edgeTypes, maxDepth, direction);
    const traversalMs = Date.now() - traversalStart;

    // ── 7. Format the result ────────────────────────────────────────────────
    const { nodes, edges } = result;

    // Header section
    const headerLines: string[] = [
        `Graph traversal from: ${startId}`,
        `Direction: ${direction} | maxDepth: ${maxDepth} | edgeTypes: ${edgeTypes.join(', ')}`,
        `Found ${nodes.length} node(s), ${edges.length} edge(s) in ${traversalMs}ms`,
        '',
    ];

    // Nodes section — grouped by depth
    const nodesByDepth = new Map<number, Array<GraphNode & { depth: number }>>();
    for (const node of nodes) {
        if (!nodesByDepth.has(node.depth)) nodesByDepth.set(node.depth, []);
        nodesByDepth.get(node.depth)!.push(node);
    }

    const nodesLines: string[] = ['=== Nodes ===', ''];
    for (const [depth, depthNodes] of [...nodesByDepth.entries()].sort((a, b) => a[0] - b[0])) {
        nodesLines.push(`--- Depth ${depth} (${depthNodes.length} node${depthNodes.length !== 1 ? 's' : ''}) ---`);
        for (const node of depthNodes) {
            nodesLines.push(formatNode(node));
        }
        nodesLines.push('');
    }

    if (nodes.length === 0) {
        nodesLines.push(`(no nodes reachable from "${startId}" with given parameters)`);
    }

    // Edges section
    const edgesLines: string[] = ['=== Edges ===', ''];
    if (edges.length === 0) {
        edgesLines.push('(no edges traversed)');
    } else {
        // Group by edge type
        const edgesByType = new Map<string, GraphEdge[]>();
        for (const edge of edges) {
            if (!edgesByType.has(edge.type)) edgesByType.set(edge.type, []);
            edgesByType.get(edge.type)!.push(edge);
        }

        for (const [type, typeEdges] of [...edgesByType.entries()].sort()) {
            edgesLines.push(`-- ${edgeTypeLabel(type as GraphEdge['type'])} (${typeEdges.length}) --`);
            for (const edge of typeEdges) {
                edgesLines.push(formatEdge(edge));
            }
            edgesLines.push('');
        }
    }

    // Build sections with priority ordering
    const sections: Section[] = [
        {
            label: '',
            content: headerLines.join('\n'),
            priority: 0, // critical — always preserved
        },
        {
            label: '',
            content: nodesLines.join('\n'),
            priority: 1, // core
        },
        {
            label: '',
            content: edgesLines.join('\n'),
            priority: 2, // extended — dropped first after footer
        },
        buildFooterSection(index, projectRoot),
    ];

    const responseText = buildResponse(sections, TOOL_BUDGET);

    // ── 8. Cache in WorkingMemory ───────────────────────────────────────────
    setInMemory(cacheKey, responseText, index.lastBuilt);

    return { content: [{ type: 'text', text: responseText }] };
}
