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
    // Semantic enrichment fields (all optional for backward compatibility)
    implements?: string[];          // interface names a class implements
    extends?: string;               // parent class or interface name
    implementedBy?: string[];       // inverted index — types implementing this interface
    isAsync?: boolean;
    isAbstract?: boolean;
    isStatic?: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
    deprecationNotice?: string;     // from @deprecated JSDoc tag
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
    // Enrichment fields (all optional for backward compatibility with old indexes)
    richnessMap?: Record<string, RichnessLevel>;    // per-file richness level
    coverageErrors?: Record<string, string>;         // file path → error message for parse failures
}

export type SummarizerMode = 'static' | 'ollama' | 'anthropic' | 'claude-code';

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
