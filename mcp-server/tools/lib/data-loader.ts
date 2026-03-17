import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnowledgeIndex, SymbolEntry, DependencyGraph, FileSummary } from '../../types.js';
import { getOrLoad } from './cache.js';
import { toRelative, resolveProjectRoot } from './path-utils.js';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Reads a file, rejecting files over 50MB. Returns raw string or null. */
function safeReadFile(filePath: string): string | null {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE_BYTES) {
            process.stderr.write(
                `[data-loader] WARNING: file ${filePath} is ${stat.size} bytes (> 50MB), skipping\n`
            );
            return null;
        }
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Loads the knowledge index. Always reads from disk first to get the current
 * lastBuilt timestamp (this is the cache invalidation signal).
 * Uses a 30-second time-based cache key to avoid constant disk re-reads.
 */
export function loadIndex(knowledgeRoot: string): KnowledgeIndex | null {
    const filePath = path.join(knowledgeRoot, 'index.json');
    // Time-based key: refreshes every 30 seconds
    const timeKey = Math.floor(Date.now() / 30000).toString();
    const cacheKey = `index:${knowledgeRoot}:${timeKey}`;

    return getOrLoad<KnowledgeIndex>(
        cacheKey,
        () => {
            const raw = safeReadFile(filePath);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as KnowledgeIndex;
            } catch {
                return null;
            }
        },
        timeKey // use timeKey as the "timestamp" for this special loader
    );
}

/**
 * Loads symbols array. Cached per index build timestamp.
 */
export function loadSymbols(knowledgeRoot: string): SymbolEntry[] | null {
    const index = loadIndex(knowledgeRoot);
    if (!index) return null;

    const cacheKey = `symbols:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'symbols.json');

    return getOrLoad<SymbolEntry[]>(
        cacheKey,
        () => {
            const raw = safeReadFile(filePath);
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? (parsed as SymbolEntry[]) : null;
            } catch {
                return null;
            }
        },
        index.lastBuilt
    );
}

/**
 * Loads dependency graph. Cached per index build timestamp.
 */
export function loadDependencies(knowledgeRoot: string): DependencyGraph | null {
    const index = loadIndex(knowledgeRoot);
    if (!index) return null;

    const cacheKey = `dependencies:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'dependencies.json');

    return getOrLoad<DependencyGraph>(
        cacheKey,
        () => {
            const raw = safeReadFile(filePath);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as DependencyGraph;
            } catch {
                return null;
            }
        },
        index.lastBuilt
    );
}

/**
 * Loads summary cache. Cached per index build timestamp.
 */
export function loadSummaryCache(knowledgeRoot: string): Record<string, FileSummary> | null {
    const index = loadIndex(knowledgeRoot);
    if (!index) return null;

    const cacheKey = `summaries:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'summaries', 'cache.json');

    return getOrLoad<Record<string, FileSummary>>(
        cacheKey,
        () => {
            const raw = safeReadFile(filePath);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as Record<string, FileSummary>;
            } catch {
                return null;
            }
        },
        index.lastBuilt
    );
}

/**
 * Returns a Map keyed by qualifiedName for O(1) symbol lookup.
 * Built and cached from the symbols array.
 */
export function loadSymbolMap(knowledgeRoot: string): Map<string, SymbolEntry> | null {
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols) return null;

    const map = new Map<string, SymbolEntry>();
    for (const sym of symbols) {
        map.set(sym.qualifiedName, sym);
    }
    return map;
}

/**
 * Returns a Map keyed by normalized relative file path → SymbolEntry[].
 * Eliminates O(n) filter scans in get-implementation-context.ts.
 */
export function loadFileToSymbols(knowledgeRoot: string): Map<string, SymbolEntry[]> | null {
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols) return null;

    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const map = new Map<string, SymbolEntry[]>();

    for (const sym of symbols) {
        const relFile = toRelative(sym.file, projectRoot);
        const existing = map.get(relFile);
        if (existing) {
            existing.push(sym);
        } else {
            map.set(relFile, [sym]);
        }
    }

    return map;
}
