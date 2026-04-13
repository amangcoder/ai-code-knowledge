/**
 * Phase 8.5: Graphify knowledge graph enrichment.
 *
 * Reads a pre-built Graphify graph from .graphify/graph.json (if it exists)
 * and merges its nodes/edges into the ai-code-knowledge knowledge graph at
 * .knowledge/graph/{nodes,edges}.json.
 *
 * This enriches the existing graph with:
 * - Community cluster IDs on nodes (metadata.community)
 * - Confidence-scored inferred relationships
 * - God node annotations
 * - Additional relationship types mapped to ai-code-knowledge's edge vocabulary
 *
 * If .graphify/graph.json does not exist, the phase is a no-op.
 * If .graphify/GRAPH_REPORT.md exists, its key sections are appended
 * to .knowledge/architecture.md for brief enrichment.
 *
 * Graphify itself is NOT invoked by this phase — it only consumes
 * pre-existing Graphify output. The caller (orchestrator, user, CI)
 * is responsible for running Graphify before the knowledge build.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphNode, GraphEdge } from '../../../src/types.js';
import { atomicWrite } from '../atomic-writer.js';
import { logInfo, logWarn } from '../logger.js';

const PHASE = 'graphify-phase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphifyPhaseResult {
    nodesAdded: number;
    edgesAdded: number;
    architectureEnriched: boolean;
    durationMs: number;
}

/** Shape of a raw Graphify node (flexible — various field names accepted). */
interface RawGraphifyNode {
    id?: string;
    name?: string;
    label?: string;
    type?: string;
    path?: string;
    file?: string;
    description?: string;
    purpose?: string;
    module?: string;
    directory?: string;
    qualifiedName?: string;
    qualified_name?: string;
    line?: number | string;
    signature?: string;
    isExported?: boolean;
    exported?: boolean;
    kind?: string;
    community?: number | string;
    cluster?: number | string;
    cluster_id?: string;
    is_god_node?: boolean;
    god_node?: boolean;
}

/** Shape of a raw Graphify edge. */
interface RawGraphifyEdge {
    source?: string;
    from?: string;
    target?: string;
    to?: string;
    type?: string;
    relationship?: string;
    label?: string;
}

/** Shape of the top-level Graphify graph.json. */
interface RawGraphifyData {
    nodes?: RawGraphifyNode[];
    edges?: RawGraphifyEdge[];
    links?: RawGraphifyEdge[];
    relationships?: RawGraphifyEdge[];
}

// Maps Graphify relationship names to ai-code-knowledge edge types
const EDGE_TYPE_MAP: Record<string, GraphEdge['type']> = {
    calls: 'calls',
    call: 'calls',
    invokes: 'calls',
    imports: 'imports',
    import: 'imports',
    requires: 'imports',
    uses: 'imports',
    depends_on: 'depends_on',
    dependency: 'depends_on',
    contains: 'contains',
    has: 'contains',
    defines: 'contains',
    implements: 'implements',
    extends: 'implements',
    inherits: 'implements',
    similar_to: 'similar_to',
    related_to: 'similar_to',
    co_changed: 'similar_to',
    inferred: 'similar_to',
};

// Keywords in GRAPH_REPORT.md headings that indicate useful sections
const REPORT_USEFUL_KEYWORDS = [
    'god node', 'hub', 'bottleneck', 'community', 'cluster',
    'coupling', 'cohesion', 'architectural', 'risk', 'hotspot',
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs the Graphify enrichment phase (Phase 8.5).
 *
 * @param knowledgeRoot  Path to .knowledge/ directory
 * @param graphifyDir    Optional override for .graphify/ directory.
 *                       Defaults to project_root/.graphify.
 */
export async function runGraphifyPhase(
    knowledgeRoot: string,
    graphifyDir?: string,
): Promise<GraphifyPhaseResult> {
    const startMs = Date.now();
    const projectRoot = path.dirname(knowledgeRoot);
    const gDir = graphifyDir ?? path.join(projectRoot, '.graphify');
    const graphJsonPath = path.join(gDir, 'graph.json');

    // No-op if Graphify output doesn't exist
    if (!fs.existsSync(graphJsonPath)) {
        logInfo(PHASE, 'No .graphify/graph.json found — skipping enrichment');
        return { nodesAdded: 0, edgesAdded: 0, architectureEnriched: false, durationMs: 0 };
    }

    // 1. Load Graphify graph
    let graphifyData: RawGraphifyData;
    try {
        graphifyData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf8')) as RawGraphifyData;
    } catch (err) {
        logWarn(PHASE, `Could not parse ${graphJsonPath}: ${err instanceof Error ? err.message : err}`);
        return { nodesAdded: 0, edgesAdded: 0, architectureEnriched: false, durationMs: Date.now() - startMs };
    }

    const rawNodes = graphifyData.nodes ?? [];
    const rawEdges = graphifyData.edges ?? graphifyData.links ?? graphifyData.relationships ?? [];

    // 2. Load existing ai-code-knowledge graph
    const nodesPath = path.join(knowledgeRoot, 'graph', 'nodes.json');
    const edgesPath = path.join(knowledgeRoot, 'graph', 'edges.json');

    let existingNodes: GraphNode[] = [];
    let existingEdges: GraphEdge[] = [];

    try {
        existingNodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8')) as GraphNode[];
    } catch {
        logWarn(PHASE, `Could not load existing nodes from ${nodesPath}`);
    }
    try {
        existingEdges = JSON.parse(fs.readFileSync(edgesPath, 'utf8')) as GraphEdge[];
    } catch {
        logWarn(PHASE, `Could not load existing edges from ${edgesPath}`);
    }

    // 3. Transform Graphify nodes to ai-code-knowledge format
    const idMap = new Map<string, string>(); // raw Graphify ID → ai-code-knowledge ID
    const newNodes: GraphNode[] = [];

    for (const raw of rawNodes) {
        const transformed = transformNode(raw, projectRoot);
        if (transformed) {
            idMap.set(String(raw.id ?? raw.name ?? raw.label ?? ''), transformed.id);
            newNodes.push(transformed);
        }
    }

    // 4. Transform Graphify edges
    const newEdges: GraphEdge[] = [];
    for (const raw of rawEdges) {
        const transformed = transformEdge(raw, idMap);
        if (transformed) {
            newEdges.push(transformed);
        }
    }

    // 5. Merge (deduplicate by ID for nodes, by triple for edges)
    const existingNodeIds = new Set(existingNodes.map(n => n.id));
    let nodesAdded = 0;
    for (const node of newNodes) {
        if (!existingNodeIds.has(node.id)) {
            existingNodes.push(node);
            existingNodeIds.add(node.id);
            nodesAdded++;
        }
    }

    const existingEdgeKeys = new Set(
        existingEdges.map(e => `${e.source}→${e.target}→${e.type}`)
    );
    let edgesAdded = 0;
    for (const edge of newEdges) {
        const key = `${edge.source}→${edge.target}→${edge.type}`;
        if (!existingEdgeKeys.has(key)) {
            existingEdges.push(edge);
            existingEdgeKeys.add(key);
            edgesAdded++;
        }
    }

    // 6. Sort for idempotent output (matches Phase 8 convention)
    existingNodes.sort((a, b) => a.id.localeCompare(b.id));
    existingEdges.sort((a, b) => {
        const key = (e: GraphEdge) => `${e.source}→${e.target}→${e.type}`;
        return key(a).localeCompare(key(b));
    });

    // 7. Write atomically
    await atomicWrite(nodesPath, JSON.stringify(existingNodes, null, 2));
    await atomicWrite(edgesPath, JSON.stringify(existingEdges, null, 2));

    // 8. Enrich architecture.md with GRAPH_REPORT.md
    const architectureEnriched = enrichArchitecture(knowledgeRoot, gDir);

    const durationMs = Date.now() - startMs;
    logInfo(PHASE, `Done: +${nodesAdded} nodes, +${edgesAdded} edges in ${durationMs}ms`);

    return { nodesAdded, edgesAdded, architectureEnriched, durationMs };
}

// ---------------------------------------------------------------------------
// Node transformation
// ---------------------------------------------------------------------------

function transformNode(raw: RawGraphifyNode, projectRoot: string): GraphNode | null {
    const rawId = raw.id ?? raw.name ?? raw.label;
    if (!rawId) return null;

    const nodeType = (raw.type ?? '').toLowerCase();
    const community = raw.community ?? raw.cluster;

    if (nodeType === 'file' || nodeType === 'source_file') {
        const filePath = raw.path ?? raw.file ?? String(rawId);
        const relPath = toRelativePath(filePath, projectRoot);
        const metadata: Record<string, string> = {
            path: relPath,
            purpose: truncate(raw.description ?? raw.purpose ?? '', 200),
            module: raw.module ?? raw.directory ?? path.dirname(relPath).split(path.sep)[0] ?? '',
            source: 'graphify',
        };
        if (community != null) metadata.community = String(community);
        return { id: `file:${relPath}`, type: 'file', metadata };
    }

    if (['function', 'class', 'method', 'interface', 'type', 'symbol'].includes(nodeType)) {
        const name = raw.name ?? String(rawId);
        const qualified = raw.qualifiedName ?? raw.qualified_name ?? name;
        const metadata: Record<string, string> = {
            qualifiedName: qualified,
            name,
            file: truncate(raw.file ?? '', 200),
            line: String(raw.line ?? ''),
            symbolType: raw.type ?? raw.kind ?? 'function',
            isExported: String(raw.isExported ?? raw.exported ?? false).toLowerCase(),
            source: 'graphify',
        };
        if (raw.signature) metadata.signature = truncate(raw.signature, 300);
        if (community != null) metadata.community = String(community);
        return { id: `symbol:${qualified}`, type: 'symbol', metadata };
    }

    if (['module', 'directory', 'package'].includes(nodeType)) {
        const name = raw.name ?? String(rawId);
        const metadata: Record<string, string> = { name, source: 'graphify' };
        if (community != null) metadata.community = String(community);
        return { id: `module:${name}`, type: 'module', metadata };
    }

    if (['community', 'cluster', 'feature'].includes(nodeType)) {
        const clusterId = raw.id ?? raw.cluster_id ?? String(rawId);
        const metadata: Record<string, string> = {
            name: raw.name ?? raw.label ?? `Community ${clusterId}`,
            description: truncate(raw.description ?? '', 200),
            id: String(clusterId),
            source: 'graphify',
        };
        if (raw.is_god_node || raw.god_node) metadata.god_node = 'true';
        return { id: `feature:${clusterId}`, type: 'feature', metadata };
    }

    if (nodeType === 'concept') {
        const conceptId = raw.id ?? String(rawId);
        return {
            id: `feature:concept-${conceptId}`,
            type: 'feature',
            metadata: {
                name: raw.name ?? String(conceptId),
                description: truncate(raw.description ?? '', 200),
                id: `concept-${conceptId}`,
                source: 'graphify',
            },
        };
    }

    // Unknown type — skip
    return null;
}

// ---------------------------------------------------------------------------
// Edge transformation
// ---------------------------------------------------------------------------

function transformEdge(
    raw: RawGraphifyEdge,
    idMap: Map<string, string>,
): GraphEdge | null {
    const sourceRaw = raw.source ?? raw.from;
    const targetRaw = raw.target ?? raw.to;
    const relType = raw.type ?? raw.relationship ?? raw.label ?? '';

    if (!sourceRaw || !targetRaw) return null;

    const source = idMap.get(String(sourceRaw)) ?? String(sourceRaw);
    const target = idMap.get(String(targetRaw)) ?? String(targetRaw);
    const type = EDGE_TYPE_MAP[relType.toLowerCase()] ?? 'similar_to';

    return { source, target, type };
}

// ---------------------------------------------------------------------------
// Architecture enrichment
// ---------------------------------------------------------------------------

function enrichArchitecture(knowledgeRoot: string, graphifyDir: string): boolean {
    const reportPath = path.join(graphifyDir, 'GRAPH_REPORT.md');
    if (!fs.existsSync(reportPath)) return false;

    let report: string;
    try {
        report = fs.readFileSync(reportPath, 'utf8').trim();
    } catch {
        return false;
    }

    if (report.length < 50) return false;

    const archPath = path.join(knowledgeRoot, 'architecture.md');
    let existing = '';
    try {
        existing = fs.readFileSync(archPath, 'utf8');
    } catch {
        // architecture.md may not exist yet
    }

    // Idempotent — don't append twice
    if (existing.includes('<!-- graphify-enrichment -->')) return false;

    const summary = extractReportSummary(report);
    if (!summary) return false;

    const enrichment = `\n\n<!-- graphify-enrichment -->\n## Graph Analysis (Graphify)\n\n${summary}\n`;

    try {
        fs.writeFileSync(archPath, existing + enrichment, 'utf8');
        logInfo(PHASE, 'Enriched architecture.md with Graphify report');
        return true;
    } catch (err) {
        logWarn(PHASE, `Could not write architecture.md: ${err instanceof Error ? err.message : err}`);
        return false;
    }
}

function extractReportSummary(report: string): string {
    const lines = report.split('\n');
    const sections: string[] = [];
    let currentSection: string[] = [];
    let inUsefulSection = false;

    for (const line of lines) {
        if (line.startsWith('## ') || line.startsWith('### ')) {
            if (inUsefulSection && currentSection.length > 0) {
                sections.push(currentSection.join('\n'));
            }
            const heading = line.toLowerCase();
            inUsefulSection = REPORT_USEFUL_KEYWORDS.some(kw => heading.includes(kw));
            currentSection = [line];
        } else if (inUsefulSection) {
            currentSection.push(line);
        }
    }

    if (inUsefulSection && currentSection.length > 0) {
        sections.push(currentSection.join('\n'));
    }

    if (sections.length === 0) {
        return report.substring(0, 2000);
    }

    const combined = sections.join('\n\n');
    return combined.length > 3000 ? combined.substring(0, 2997) + '...' : combined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRelativePath(filePath: string, projectRoot: string): string {
    if (path.isAbsolute(filePath)) {
        return path.relative(projectRoot, filePath);
    }
    return filePath;
}

function truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.substring(0, maxLen - 3) + '...' : s;
}
