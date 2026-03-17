import * as fs from 'node:fs';
import * as path from 'node:path';
import { KnowledgeIndex, SymbolEntry, DependencyGraph, FileSummary } from '../../src/types.js';
import { atomicWrite } from './atomic-writer.js';

/**
 * Reads .knowledge/ artifacts and produces a KnowledgeIndex.
 */
export async function buildIndex(knowledgeRoot: string): Promise<KnowledgeIndex> {
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    const depsPath = path.join(knowledgeRoot, 'dependencies.json');
    const summariesCachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');

    // --- symbols.json ---
    let symbols: SymbolEntry[] = [];
    let hasSymbols = false;
    if (fs.existsSync(symbolsPath)) {
        try {
            const raw = fs.readFileSync(symbolsPath, 'utf8');
            const parsed: SymbolEntry[] = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                symbols = parsed;
                hasSymbols = true;
            }
        } catch {
            // malformed file — treat as absent
        }
    }

    // Count unique source files referenced in symbols.json
    const uniqueFiles = new Set<string>(symbols.map(s => s.file));
    const fileCount = uniqueFiles.size;

    // Count symbols by type
    const symbolCounts: Record<string, number> = {};
    for (const s of symbols) {
        symbolCounts[s.type] = (symbolCounts[s.type] ?? 0) + 1;
    }

    // --- dependencies.json ---
    let modules: string[] = [];
    let hasDependencies = false;
    if (fs.existsSync(depsPath)) {
        try {
            const raw = fs.readFileSync(depsPath, 'utf8');
            const parsed: DependencyGraph = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                modules = parsed.nodes;
                hasDependencies = true;
            }
        } catch {
            // malformed file — treat as absent
        }
    }

    // --- summaries/cache.json ---
    let summaries: string[] = [];
    if (fs.existsSync(summariesCachePath)) {
        try {
            const raw = fs.readFileSync(summariesCachePath, 'utf8');
            const parsed: Record<string, FileSummary> = JSON.parse(raw);
            summaries = Object.keys(parsed);
        } catch {
            // malformed file — leave summaries empty
        }
    }

    return {
        modules,
        summaries,
        hasSymbols,
        hasDependencies,
        lastBuilt: new Date().toISOString(),
        fileCount,
        symbolCounts: hasSymbols ? symbolCounts : undefined,
    };
}

/**
 * Writes a KnowledgeIndex to <knowledgeRoot>/index.json atomically.
 */
export async function writeIndex(knowledgeRoot: string, index: KnowledgeIndex): Promise<void> {
    const indexPath = path.join(knowledgeRoot, 'index.json');
    await atomicWrite(indexPath, JSON.stringify(index, null, 2));
}
