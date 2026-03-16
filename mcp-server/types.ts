/**
 * AUTO-GENERATED from src/types.ts — do not edit directly.
 * Run "npm run sync-types" to regenerate.
 *
 * Kept separate from src/types.ts because tsconfig.mcp.json uses
 * rootDir: "mcp-server", which cannot import from src/.
 */

export interface SymbolEntry {
    name: string;
    qualifiedName: string;
    file: string;
    line: number;
    signature: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'method';
    module: string;
    calls: string[];
    calledBy: string[];
    throws: string[];
    isExported: boolean;
}

export interface DependencyGraph {
    nodes: string[];
    edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }>;
    cycles: string[][];
    fileDeps: Record<string, string[]>;
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
}
