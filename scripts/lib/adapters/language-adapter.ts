import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';

/**
 * Context passed to adapter extraction methods for a single file.
 */
export interface FileContext {
    filePath: string;        // absolute path
    relativePath: string;    // relative to project root (forward slashes)
    content: string;
    projectRoot: string;
}

/**
 * Language adapter interface. Each supported language provides an implementation
 * that handles symbol extraction, dependency extraction, and call graph building.
 *
 * Adapters produce the same SymbolEntry[] / ImportInfo[] output regardless of
 * language, so the orchestration layer can treat all languages uniformly.
 */
export interface LanguageAdapter {
    /** Unique language identifier (e.g., 'typescript', 'python', 'go') */
    readonly language: string;

    /** File extensions this adapter handles, with dots (e.g., ['.ts', '.tsx']) */
    readonly extensions: string[];

    /** Marker files that indicate this language is present in a project (e.g., ['tsconfig.json']) */
    readonly projectMarkers: string[];

    /** Directories to ignore when scanning for source files */
    readonly ignoreDirs: string[];

    /**
     * One-time initialization when processing begins.
     * For adapters that need upfront context (e.g., ts-morph needs a Project with all files),
     * this is where that setup happens. Receives all file paths that will be processed.
     */
    initialize?(filePaths: string[], projectRoot: string): Promise<void>;

    /**
     * Extract symbols (functions, classes, methods, etc.) from a single file.
     * At 'standard'+ richness, includes JSDoc, parameter docs, return types, decorators.
     */
    extractSymbols(ctx: FileContext, richness?: RichnessLevel): SymbolEntry[];

    /**
     * Extract import/dependency information from a single file.
     */
    extractDependencies(ctx: FileContext): ImportInfo[];

    /**
     * Build call graph edges for a set of symbols.
     * Receives all symbols belonging to this language and a map of file contents.
     * Returns symbols with `calls` arrays populated.
     * Does NOT need to handle `calledBy` — the orchestrator runs invertCallGraph.
     */
    buildCallGraph(
        symbols: SymbolEntry[],
        fileContents: Map<string, string>,
        projectRoot: string
    ): SymbolEntry[];

    /**
     * Optional cleanup when processing completes (release AST caches, etc.)
     */
    dispose?(): void;
}

export type { SymbolEntry, ImportInfo, RichnessLevel };
