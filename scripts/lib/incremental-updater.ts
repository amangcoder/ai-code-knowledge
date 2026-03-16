import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Project } from 'ts-morph';
import { SymbolEntry, FileSummary } from '../../src/types.js';
import { atomicWrite } from './atomic-writer.js';
import { extractSymbols } from './symbol-extractor.js';
import { buildCallGraph, invertCallGraph } from './call-graph.js';
import { createSummarizer } from './summarizer-factory.js';

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

/**
 * Normalizes a file path to a relative path using forward slashes.
 */
function normalizeFilePath(filePath: string, projectRoot: string): string {
    const rel = path.relative(projectRoot, path.resolve(filePath));
    return rel.split(path.sep).join('/');
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

    // Load current artifacts
    const allSymbols = loadSymbols(knowledgeRoot);
    const summaryCache = loadSummaryCache(knowledgeRoot);

    // Remove all existing entries for this file
    const filteredSymbols = allSymbols.filter(s => s.file !== normalizedPath);

    // Re-extract symbols for the changed file using ts-morph
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsconfigPath);

    const absoluteFilePath = path.resolve(filePath);
    if (!fs.existsSync(absoluteFilePath)) {
        // File was removed — treat as deletion
        await handleFileDeletion(filePath, knowledgeRoot);
        return;
    }

    // Load full project so cross-file call resolution works
    const project = new Project({
        tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
        skipAddingFilesFromTsConfig: false,
    });

    if (!hasTsConfig) {
        project.addSourceFilesAtPaths(path.join(projectRoot, 'src/**/*.ts'));
    }

    // Ensure the changed file is in the project
    let sourceFile = project.getSourceFile(absoluteFilePath);
    if (!sourceFile) {
        sourceFile = project.addSourceFileAtPath(absoluteFilePath);
    }

    const newSymbols = extractSymbols(sourceFile, projectRoot);

    // Merge all symbols and rebuild call graph over the full set for correctness
    const allMergedSymbols = [...filteredSymbols, ...newSymbols];
    const symbolsWithCalls = buildCallGraph(project, allMergedSymbols);
    const mergedSymbols = invertCallGraph(symbolsWithCalls);

    // Update summaries cache for the changed file
    const content = fs.readFileSync(absoluteFilePath, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const summarizer = createSummarizer();
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
