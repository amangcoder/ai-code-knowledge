import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { SymbolEntry, FileSummary, RichnessLevel, KnowledgeIndex } from '../../src/types.js';
import { atomicWrite } from './atomic-writer.js';
import { invertCallGraph } from './call-graph.js';
import { createSummarizer } from './summarizer-factory.js';
import { createDefaultRegistry, TypeScriptAdapter } from './adapters/index.js';
import type { AdapterRegistry } from './adapters/adapter-registry.js';
import type { FileContext } from './adapters/language-adapter.js';
import { logInfo, logError } from './logger.js';
import { normalizeFilePath } from './path-utils.js';

const SYMBOLS_FILE = 'symbols.json';
const SUMMARY_CACHE_FILE = path.join('summaries', 'cache.json');

function loadSymbols(knowledgeRoot: string): SymbolEntry[] {
    const symbolsPath = path.join(knowledgeRoot, SYMBOLS_FILE);
    if (!fs.existsSync(symbolsPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(symbolsPath, 'utf-8')) as SymbolEntry[];
    } catch {
        return [];
    }
}

function loadSummaryCache(knowledgeRoot: string): Record<string, FileSummary> {
    const cachePath = path.join(knowledgeRoot, SUMMARY_CACHE_FILE);
    if (!fs.existsSync(cachePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Record<string, FileSummary>;
    } catch {
        return {};
    }
}

function loadRichnessLevel(knowledgeRoot: string): RichnessLevel {
    const indexPath = path.join(knowledgeRoot, 'index.json');
    if (!fs.existsSync(indexPath)) return 'minimal';
    try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as KnowledgeIndex;
        return index.richness ?? 'minimal';
    } catch {
        return 'minimal';
    }
}

function makeFileContext(filePath: string, content: string, projectRoot: string): FileContext {
    return {
        filePath,
        relativePath: path.relative(projectRoot, filePath).split(path.sep).join('/'),
        content,
        projectRoot,
    };
}

/**
 * Re-processes a single changed file: removes old symbol entries, re-extracts symbols,
 * rebuilds call graph entries, updates summaries cache, and writes both artifacts atomically.
 * Must complete in under 1 second for a single file.
 */
export async function handleFileChange(
    filePath: string,
    knowledgeRoot: string,
    projectRoot: string
): Promise<void> {
    const normalizedPath = normalizeFilePath(filePath, projectRoot);
    const richness = loadRichnessLevel(knowledgeRoot);

    // Load current artifacts
    const allSymbols = loadSymbols(knowledgeRoot);
    const summaryCache = loadSummaryCache(knowledgeRoot);

    // Remove all existing entries for this file
    const filteredSymbols = allSymbols.filter(s => s.file !== normalizedPath);

    const absoluteFilePath = path.resolve(filePath);
    if (!fs.existsSync(absoluteFilePath)) {
        await handleFileDeletion(filePath, knowledgeRoot);
        return;
    }

    const registry = createDefaultRegistry();
    const adapter = registry.getForFile(filePath);
    if (!adapter) return; // unsupported file type

    const content = fs.readFileSync(absoluteFilePath, 'utf-8');
    const ctx = makeFileContext(absoluteFilePath, content, projectRoot);

    // Initialize adapter (for TS this creates the ts-morph Project)
    if (adapter.initialize) {
        // For TS/JS, we need all project files loaded for call graph resolution
        if (adapter instanceof TypeScriptAdapter) {
            const tsJsGlob = path.join(projectRoot, '**/*.{ts,tsx,js,jsx,mjs}');
            await adapter.initialize([tsJsGlob], projectRoot);
        } else {
            await adapter.initialize([absoluteFilePath], projectRoot);
        }
    }

    // Extract symbols
    const newSymbols = adapter.extractSymbols(ctx, richness);
    const allMergedSymbols = [...filteredSymbols, ...newSymbols];

    // Build call graph
    let mergedSymbols: SymbolEntry[];
    if (adapter instanceof TypeScriptAdapter) {
        // Use the optimized single-file rebuild for TS/JS
        mergedSymbols = adapter.rebuildCallGraphForFile(allMergedSymbols, absoluteFilePath, projectRoot);
    } else {
        // Generic path: rebuild call graph for this language's symbols
        const langSymbols = allMergedSymbols.filter(s => s.language === adapter.language);
        const contents = new Map<string, string>();
        contents.set(normalizedPath, content);
        const withCalls = adapter.buildCallGraph(langSymbols, contents, projectRoot);
        const otherSymbols = allMergedSymbols.filter(s => s.language !== adapter.language);
        mergedSymbols = invertCallGraph([...otherSymbols, ...withCalls]);
    }

    // Update summaries cache for the changed file
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const summarizer = createSummarizer(richness);
    const fileSymbols = mergedSymbols.filter(s => s.file === normalizedPath);
    const summary = await summarizer.summarizeFile(normalizedPath, content, fileSymbols);
    summary.contentHash = contentHash;
    summary.lastUpdated = new Date().toISOString();
    summaryCache[normalizedPath] = summary;

    // Write both artifacts atomically
    await atomicWrite(
        path.join(knowledgeRoot, SYMBOLS_FILE),
        JSON.stringify(mergedSymbols, null, 2)
    );
    await atomicWrite(
        path.join(knowledgeRoot, SUMMARY_CACHE_FILE),
        JSON.stringify(summaryCache, null, 2)
    );
}

/**
 * Processes multiple interdependent file changes in a single pass to avoid cross-file
 * call graph staleness. When files A and B both change in one batch, this ensures that
 * A's call graph is rebuilt against B's fresh symbols (and vice versa), then a single
 * invertCallGraph pass produces consistent calledBy edges.
 */
export async function handleBatchFileChanges(
    files: Array<{ path: string; type: 'change' | 'delete' }>,
    knowledgeRoot: string,
    projectRoot: string
): Promise<void> {
    const richness = loadRichnessLevel(knowledgeRoot);

    // 1. Handle deletions first
    const deletions = files.filter(f => f.type === 'delete');
    const changes = files.filter(f => f.type === 'change');

    for (const del of deletions) {
        await handleFileDeletion(del.path, knowledgeRoot);
    }

    if (changes.length === 0) return;

    // 2. If only 1 changed file, use the existing single-file path
    if (changes.length === 1) {
        await handleFileChange(changes[0].path, knowledgeRoot, projectRoot);
        return;
    }

    // 3. For multiple changes: load symbols once, extract all, rebuild call graph together
    const allSymbols = loadSymbols(knowledgeRoot);
    const summaryCache = loadSummaryCache(knowledgeRoot);

    // Remove entries for all changed files at once
    const changedPaths = new Set(changes.map(f => normalizeFilePath(f.path, projectRoot)));
    const filteredSymbols = allSymbols.filter(s => !changedPaths.has(s.file));

    // Group files by language adapter, skipping files that no longer exist
    const registry = createDefaultRegistry();
    const filesByAdapter = new Map<string, Array<{ filePath: string; absolutePath: string; normalizedPath: string; content: string }>>();

    for (const change of changes) {
        const absolutePath = path.resolve(change.path);
        if (!fs.existsSync(absolutePath)) {
            await handleFileDeletion(change.path, knowledgeRoot);
            continue;
        }
        const adapter = registry.getForFile(change.path);
        if (!adapter) continue;

        const normalizedPath = normalizeFilePath(change.path, projectRoot);
        const content = fs.readFileSync(absolutePath, 'utf-8');

        let list = filesByAdapter.get(adapter.language);
        if (!list) {
            list = [];
            filesByAdapter.set(adapter.language, list);
        }
        list.push({ filePath: change.path, absolutePath, normalizedPath, content });
    }

    // 4. Initialize adapters and extract symbols per language
    let allNewSymbols: SymbolEntry[] = [];

    for (const [lang, langFiles] of filesByAdapter) {
        const adapter = registry.getByLanguage(lang)!;

        if (adapter.initialize) {
            if (adapter instanceof TypeScriptAdapter) {
                const tsJsGlob = path.join(projectRoot, '**/*.{ts,tsx,js,jsx,mjs}');
                await adapter.initialize([tsJsGlob], projectRoot);
            } else {
                await adapter.initialize(langFiles.map(f => f.absolutePath), projectRoot);
            }
        }

        for (const file of langFiles) {
            const ctx = makeFileContext(file.absolutePath, file.content, projectRoot);
            allNewSymbols.push(...adapter.extractSymbols(ctx, richness));
        }
    }

    // 5. Merge all symbols: unchanged + newly extracted
    let mergedSymbols = [...filteredSymbols, ...allNewSymbols];

    // 6. Rebuild call graphs per language
    for (const [lang, langFiles] of filesByAdapter) {
        const adapter = registry.getByLanguage(lang)!;

        if (adapter instanceof TypeScriptAdapter && langFiles.length > 0) {
            // Use optimized batch rebuild for TS/JS
            const absolutePaths = langFiles.map(f => f.absolutePath);
            mergedSymbols = adapter.rebuildCallGraphForFiles(mergedSymbols, absolutePaths, projectRoot);
        } else if (langFiles.length > 0) {
            // Generic path: rebuild call graph for this language's symbols
            const langSymbols = mergedSymbols.filter(s => s.language === lang);
            const contents = new Map<string, string>();
            for (const file of langFiles) {
                contents.set(file.normalizedPath, file.content);
            }
            const withCalls = adapter.buildCallGraph(langSymbols, contents, projectRoot);
            const otherSymbols = mergedSymbols.filter(s => s.language !== lang);
            mergedSymbols = [...otherSymbols, ...withCalls];
        }
    }

    // 7. Single invertCallGraph pass over the merged result
    mergedSymbols = invertCallGraph(mergedSymbols);

    // 8. Update summaries for all changed files
    const summarizer = createSummarizer(richness);
    for (const [, langFiles] of filesByAdapter) {
        for (const file of langFiles) {
            const contentHash = crypto.createHash('sha256').update(file.content).digest('hex');
            const fileSymbols = mergedSymbols.filter(s => s.file === file.normalizedPath);
            const summary = await summarizer.summarizeFile(file.normalizedPath, file.content, fileSymbols);
            summary.contentHash = contentHash;
            summary.lastUpdated = new Date().toISOString();
            summaryCache[file.normalizedPath] = summary;
        }
    }

    // 9. Write both artifacts atomically -- once at the end
    await atomicWrite(
        path.join(knowledgeRoot, SYMBOLS_FILE),
        JSON.stringify(mergedSymbols, null, 2)
    );
    await atomicWrite(
        path.join(knowledgeRoot, SUMMARY_CACHE_FILE),
        JSON.stringify(summaryCache, null, 2)
    );
}

/**
 * Removes entries for a deleted file from symbols.json and summaries cache, writing atomically.
 */
export async function handleFileDeletion(
    filePath: string,
    knowledgeRoot: string
): Promise<void> {
    // Determine the project root (parent of .knowledge dir or common convention)
    const projectRoot = path.resolve(knowledgeRoot, '..');
    const normalizedPath = normalizeFilePath(filePath, projectRoot);

    // Load and filter symbols
    const allSymbols = loadSymbols(knowledgeRoot);
    const filteredSymbols = allSymbols.filter(s => s.file !== normalizedPath);

    // Remove stale calledBy/calls references to removed symbols
    const removedQualifiedNames = new Set(
        allSymbols.filter(s => s.file === normalizedPath).map(s => s.qualifiedName)
    );
    const cleanedSymbols = filteredSymbols.map(s => ({
        ...s,
        calls: s.calls.filter(c => !removedQualifiedNames.has(c)),
        calledBy: s.calledBy.filter(c => !removedQualifiedNames.has(c)),
    }));

    // Load and filter summary cache
    const summaryCache = loadSummaryCache(knowledgeRoot);
    delete summaryCache[normalizedPath];

    // Also remove from dependencies.json (best-effort)
    const depsPath = path.join(knowledgeRoot, 'dependencies.json');
    if (fs.existsSync(depsPath)) {
        try {
            const depGraph = JSON.parse(fs.readFileSync(depsPath, 'utf-8'));
            if (depGraph.fileDeps && depGraph.fileDeps[normalizedPath]) {
                delete depGraph.fileDeps[normalizedPath];
                await atomicWrite(depsPath, JSON.stringify(depGraph, null, 2));
            }
        } catch { /* best-effort */ }
    }

    // Write both artifacts atomically
    await atomicWrite(
        path.join(knowledgeRoot, SYMBOLS_FILE),
        JSON.stringify(cleanedSymbols, null, 2)
    );
    await atomicWrite(
        path.join(knowledgeRoot, SUMMARY_CACHE_FILE),
        JSON.stringify(summaryCache, null, 2)
    );
}
