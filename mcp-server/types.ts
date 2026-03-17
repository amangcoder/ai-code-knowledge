/**
 * AUTO-GENERATED from src/types.ts — do not edit directly.
 * Run "npm run sync-types" to regenerate.
 *
 * Kept separate from src/types.ts because tsconfig.mcp.json uses
 * rootDir: "mcp-server", which cannot import from src/.
 */

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
}

export type SummarizerMode = 'static' | 'ollama' | 'anthropic' | 'claude-code';

/** MCP tool handler response format. */
export interface CallToolResult {
    [key: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}
