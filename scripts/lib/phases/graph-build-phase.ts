/**
 * Phase 8: Knowledge graph construction pipeline phase.
 *
 * Reads symbols.json, dependencies.json, and summaries/cache.json,
 * builds a KnowledgeGraph, and writes graph/nodes.json + graph/edges.json.
 *
 * Sorts nodes and edges by ID for idempotent output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    SymbolEntry,
    DependencyGraph,
    FileSummary,
    GraphBuildResult,
    FeatureGroup,
} from '../../../src/types.js';
import {
    buildKnowledgeGraph,
} from '../../../mcp-server/tools/lib/knowledge-graph.js';
import { atomicWrite } from '../atomic-writer.js';
import { logInfo, logError } from '../logger.js';

const PHASE = 'graph-build-phase';

export type { GraphBuildResult };

/**
 * Runs the graph build phase (Phase 8).
 *
 * @param knowledgeRoot  Path to .knowledge/ directory
 */
export async function runGraphBuildPhase(
    knowledgeRoot: string
): Promise<GraphBuildResult> {
    const startMs = Date.now();

    // 1. Load symbols
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    let symbols: SymbolEntry[] = [];
    try {
        const raw = fs.readFileSync(symbolsPath, 'utf8');
        symbols = JSON.parse(raw) as SymbolEntry[];
    } catch {
        logError(PHASE, `Could not load symbols from ${symbolsPath}`);
    }

    // 2. Load dependencies
    const depsPath = path.join(knowledgeRoot, 'dependencies.json');
    let deps: DependencyGraph = { nodes: [], edges: [], cycles: [], fileDeps: {} };
    try {
        const raw = fs.readFileSync(depsPath, 'utf8');
        deps = JSON.parse(raw) as DependencyGraph;
    } catch {
        logError(PHASE, `Could not load dependencies from ${depsPath}`);
    }

    // 3. Load summaries
    const summariesPath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    const summaries: Record<string, FileSummary> = {};
    try {
        const raw = fs.readFileSync(summariesPath, 'utf8');
        Object.assign(summaries, JSON.parse(raw) as Record<string, FileSummary>);
    } catch {
        logError(PHASE, `Could not load summaries from ${summariesPath}`);
    }

    // 4. Load features (optional — may not exist yet)
    const featuresPath = path.join(knowledgeRoot, 'features', 'index.json');
    let features: FeatureGroup[] | undefined;
    try {
        const raw = fs.readFileSync(featuresPath, 'utf8');
        features = JSON.parse(raw) as FeatureGroup[];
    } catch {
        // Features not required — Phase 9 runs after Phase 8
    }

    // 5. Build graph — projectRoot is knowledgeRoot's parent (project root)
    const projectRoot = path.dirname(knowledgeRoot);
    const graph = buildKnowledgeGraph(symbols, deps, summaries, projectRoot, features);

    // 6. Sort nodes and edges for idempotent output
    const sortedNodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = [...graph.edges].sort((a, b) => {
        const key = (e: typeof a) => `${e.source}→${e.target}→${e.type}`;
        return key(a).localeCompare(key(b));
    });

    // 7. Write atomically
    const graphDir = path.join(knowledgeRoot, 'graph');
    fs.mkdirSync(graphDir, { recursive: true });

    await atomicWrite(
        path.join(graphDir, 'nodes.json'),
        JSON.stringify(sortedNodes, null, 2)
    );
    await atomicWrite(
        path.join(graphDir, 'edges.json'),
        JSON.stringify(sortedEdges, null, 2)
    );

    const durationMs = Date.now() - startMs;
    logInfo(PHASE, `Done: ${sortedNodes.length} nodes, ${sortedEdges.length} edges in ${durationMs}ms`);

    return {
        nodeCount: sortedNodes.length,
        edgeCount: sortedEdges.length,
        durationMs,
    };
}
