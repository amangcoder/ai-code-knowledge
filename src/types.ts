export interface SymbolEntry {
    name: string;
    qualifiedName: string;        // "OrderService.createOrder"
    file: string;                 // relative path from project root
    line: number;
    signature: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'method';
    module: string;               // parent directory name
    calls: string[];              // qualifiedNames of called symbols
    calledBy: string[];           // qualifiedNames of callers (inverted index)
    throws: string[];
    isExported: boolean;
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
}

export interface CallSite {
    caller: string;
    file: string;
    line: number;
    callChain: string[];
}

export type SummarizerMode = 'static' | 'ollama' | 'anthropic';
