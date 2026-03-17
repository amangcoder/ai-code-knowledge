/**
 * AUTO-GENERATED from src/types.ts — do not edit directly.
 * Run "npm run sync-types" to regenerate.
 *
 * Kept separate from src/types.ts because tsconfig.mcp.json uses
 * rootDir: "mcp-server", which cannot import from src/.
 */

export type RichnessLevel = 'minimal' | 'standard' | 'rich';

export interface ParameterDoc {
    name: string;
    type: string;
    description?: string;
    optional?: boolean;
    defaultValue?: string;
}

export interface PublicAPIEntry {
    name: string;
    type: string;
    signature: string;
    jsdoc?: string;
}

export interface SymbolEntry {
    name: string;
    qualifiedName: string;        // "OrderService.createOrder"
    file: string;                 // absolute path
    line: number;
    signature: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'method' | 'module-init' | 'decorator' | 'enum' | 'constructor';
    module: string;               // parent directory name
    calls: string[];              // qualifiedNames of called symbols
    calledBy: string[];           // qualifiedNames of callers (inverted index)
    throws: string[];
    isExported: boolean;
    language?: string;
    // Standard-level fields
    jsdoc?: string;
    parameters?: ParameterDoc[];
    returnType?: string;
    decorators?: string[];
    // Rich-level fields
    complexity?: number;
    isAsync?: boolean;
    accessModifier?: string;
    deprecationNotice?: string;
}

export interface DependencyGraph {
    nodes: string[];
    edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }>;
    cycles: string[][];
    fileDeps: Record<string, string[]>;  // file -> imported file paths
}

export interface FileSummary {
    file: string;
    purpose: string;
    exports: string[];
    dependencies: string[];
    sideEffects: string[];
    throws: string[];
    lastUpdated: string;
    contentHash: string;
    // Standard-level fields
    detailedPurpose?: string;
    publicAPI?: PublicAPIEntry[];
    internalPatterns?: string[];
    // Rich-level fields
    architecturalRole?: string;
    complexityScore?: number;
    testFiles?: string[];
    llmDescription?: string;
}

export interface KnowledgeIndex {
    modules: string[];
    summaries: string[];
    hasSymbols: boolean;
    hasDependencies: boolean;
    lastBuilt: string;
    fileCount: number;
    buildInProgress?: boolean;
    buildGeneration?: number;
    symbolCounts?: Record<string, number>;
    richness?: RichnessLevel;
    coverageErrors?: string[];
}

export type SummarizerMode = 'static' | 'ollama' | 'anthropic' | 'claude-code';

export interface SummarizerConfig {
    mode?: SummarizerMode;
    model?: string;
    apiKey?: string;
    maxDescriptionLength?: number;
    timeoutMs?: number;
}

/** Schema definition for a pipeline artifact type. */
export interface ArtifactSchema {
    requiredKeys: string[];
    keyTypes: Record<string, string>;
    exampleStructure: Record<string, unknown>;
    notes: string;
}

/** MCP tool handler response format. */
export interface CallToolResult {
    [key: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

// ── Vector Intelligence Types ──────────────────────────────────────────────

/** Result from ANN vector similarity search. */
export interface VectorSearchResult {
    id: string;
    score: number;
    metadata: Record<string, string>;
}

/** Result from BM25 keyword search. */
export interface BM25Result {
    id: string;
    score: number;
}

/** Combined result from hybrid BM25 + vector search (via RRF). */
export interface HybridSearchResult {
    id: string;
    score: number;
    source: 'bm25' | 'vector' | 'hybrid';
    metadata: Record<string, string>;
}

/** Query routing decision from the QueryRouter. */
export interface QueryRoute {
    strategy: 'exact_symbol' | 'feature_search' | 'graph_traversal' | 'vector_search' | 'hybrid';
    confidence: number;
    suggestedScope: 'symbols' | 'features' | 'files' | 'all';
}

/** Arguments for the semantic_search MCP tool. */
export interface SemanticSearchArgs {
    query: string;
    scope?: 'files' | 'symbols' | 'features' | 'all';
    topK?: number;
}

/** A cross-cutting feature cluster discovered from file embeddings. */
export interface FeatureGroup {
    id: string;
    name: string;
    description: string;
    files: string[];
    entryPoints: string[];
    dataFlow: string;
    keySymbols: string[];
    relatedFeatures: string[];
}

/** Result returned by the embedding pipeline phase (Phase 7). */
export interface EmbeddingPhaseResult {
    filesEmbedded: number;
    symbolsEmbedded: number;
    skipped: number;
    durationMs: number;
}

/** Result returned by the graph build phase (Phase 8). */
export interface GraphBuildResult {
    nodeCount: number;
    edgeCount: number;
    durationMs: number;
}

/** Result returned by the feature discovery phase (Phase 9). */
export interface FeatureDiscoveryResult {
    featuresDiscovered: number;
    durationMs: number;
}

// ── Knowledge Graph Types ──────────────────────────────────────────────────

/** A node in the heterogeneous knowledge graph. */
export interface GraphNode {
    id: string;
    /** Node type: file, symbol, module, feature, or external package */
    type: 'file' | 'symbol' | 'module' | 'feature' | 'package';
    metadata: Record<string, string>;
}

/** A directed edge in the knowledge graph. */
export interface GraphEdge {
    source: string;
    target: string;
    /** Edge type describing the relationship */
    type: 'contains' | 'calls' | 'imports' | 'depends_on' | 'implements' | 'similar_to';
    weight?: number;
}

/** In-memory knowledge graph with typed nodes and edges. */
export interface KnowledgeGraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/** Result of a BFS graph traversal — nodes annotated with traversal depth. */
export interface TraversalResult {
    nodes: Array<GraphNode & { depth: number }>;
    edges: GraphEdge[];
}

/** Arguments for the explore_graph MCP tool. */
export interface ExploreGraphArgs {
    start: string;
    edgeTypes?: string[];
    maxDepth?: number;
    direction?: 'outgoing' | 'incoming' | 'both';
}
