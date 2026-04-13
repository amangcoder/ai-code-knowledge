import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOrLoad } from './cache.js';
import { toRelative, resolveProjectRoot } from './path-utils.js';
import { createBM25Index } from './bm25-index.js';
import { loadGraph, buildKnowledgeGraph } from './knowledge-graph.js';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
/** Reads a file, rejecting files over 50MB. Returns raw string or null. */
function safeReadFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE_BYTES) {
            process.stderr.write(`[data-loader] WARNING: file ${filePath} is ${stat.size} bytes (> 50MB), skipping\n`);
            return null;
        }
        return fs.readFileSync(filePath, 'utf8');
    }
    catch {
        return null;
    }
}
/**
 * Loads the knowledge index. Always reads from disk first to get the current
 * lastBuilt timestamp (this is the cache invalidation signal).
 * Uses a 30-second time-based cache key to avoid constant disk re-reads.
 */
export function loadIndex(knowledgeRoot) {
    const filePath = path.join(knowledgeRoot, 'index.json');
    // Time-based key: refreshes every 30 seconds
    const timeKey = Math.floor(Date.now() / 30000).toString();
    const cacheKey = `index:${knowledgeRoot}:${timeKey}`;
    return getOrLoad(cacheKey, () => {
        const raw = safeReadFile(filePath);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }, timeKey // use timeKey as the "timestamp" for this special loader
    );
}
/**
 * Loads symbols array. Cached per index build timestamp.
 */
export function loadSymbols(knowledgeRoot) {
    const index = loadIndex(knowledgeRoot);
    if (!index)
        return null;
    const cacheKey = `symbols:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'symbols.json');
    return getOrLoad(cacheKey, () => {
        const raw = safeReadFile(filePath);
        if (!raw)
            return null;
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        }
        catch {
            return null;
        }
    }, index.lastBuilt);
}
/**
 * Loads dependency graph. Cached per index build timestamp.
 */
export function loadDependencies(knowledgeRoot) {
    const index = loadIndex(knowledgeRoot);
    if (!index)
        return null;
    const cacheKey = `dependencies:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'dependencies.json');
    return getOrLoad(cacheKey, () => {
        const raw = safeReadFile(filePath);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }, index.lastBuilt);
}
/**
 * Loads summary cache. Cached per index build timestamp.
 */
export function loadSummaryCache(knowledgeRoot) {
    const index = loadIndex(knowledgeRoot);
    if (!index)
        return null;
    const cacheKey = `summaries:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    return getOrLoad(cacheKey, () => {
        const raw = safeReadFile(filePath);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }, index.lastBuilt);
}
/**
 * Returns a Map keyed by qualifiedName for O(1) symbol lookup.
 * Built and cached from the symbols array.
 */
export function loadSymbolMap(knowledgeRoot) {
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols)
        return null;
    const map = new Map();
    for (const sym of symbols) {
        map.set(sym.qualifiedName, sym);
    }
    return map;
}
/**
 * Returns a Map keyed by normalized relative file path → SymbolEntry[].
 * Eliminates O(n) filter scans in get-implementation-context.ts.
 */
export function loadFileToSymbols(knowledgeRoot) {
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols)
        return null;
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const map = new Map();
    for (const sym of symbols) {
        const relFile = toRelative(sym.file, projectRoot);
        const existing = map.get(relFile);
        if (existing) {
            existing.push(sym);
        }
        else {
            map.set(relFile, [sym]);
        }
    }
    return map;
}
// ── Vector Intelligence Loaders ────────────────────────────────────────────
/**
 * Loads the feature groups from .knowledge/features/index.json.
 * Returns null if the file does not exist (features not yet discovered).
 */
export function loadFeatureGroups(knowledgeRoot) {
    const index = loadIndex(knowledgeRoot);
    if (!index)
        return null;
    const cacheKey = `features:${knowledgeRoot}`;
    const filePath = path.join(knowledgeRoot, 'features', 'index.json');
    return getOrLoad(cacheKey, () => {
        const raw = safeReadFile(filePath);
        if (!raw)
            return null;
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        }
        catch {
            return null;
        }
    }, index.lastBuilt);
}
/**
 * Attempts to open the LanceDB VectorStore at .knowledge/vectors/.
 *
 * Returns null when:
 *   - The vectors directory does not exist (embeddings not yet built)
 *   - @lancedb/lancedb is not installed (optional dependency)
 *
 * Errors from LanceDB are caught and re-thrown with a user-friendly message.
 *
 * NOTE: This function is async because LanceDB requires async connection setup.
 */
export async function loadVectorStore(knowledgeRoot) {
    const vectorsDir = path.join(knowledgeRoot, 'vectors');
    // Quick check — if directory doesn't exist, vectors haven't been built
    if (!fs.existsSync(vectorsDir)) {
        return null;
    }
    // Try to dynamically import @lancedb/lancedb (optional dependency).
    // We use Function constructor to bypass TypeScript's module-resolution check
    // since this is an optional package that may not be installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lancedb;
    try {
        // Using Function constructor prevents TSC from resolving '@lancedb/lancedb'
        // at compile time — safe because we catch any runtime import errors.
        const dynamicImport = new Function('m', 'return import(m)');
        lancedb = await dynamicImport('@lancedb/lancedb');
    }
    catch {
        process.stderr.write('[data-loader] @lancedb/lancedb not installed — vector search unavailable\n');
        return null;
    }
    try {
        const db = await lancedb.connect(vectorsDir);
        // Verify at least one of the expected tables exists
        const tableNames = await db.tableNames();
        const hasVectors = tableNames.includes('files') ||
            tableNames.includes('symbols') ||
            tableNames.includes('features');
        if (!hasVectors) {
            return null;
        }
        /**
         * Perform ANN search on a named table, returning VectorSearchResult[].
         * Returns [] if the table doesn't exist.
         */
        async function searchTable(tableName, embedding, topK) {
            if (!tableNames.includes(tableName))
                return [];
            try {
                const table = await db.openTable(tableName);
                const rows = await table
                    .search(embedding)
                    .limit(topK)
                    .toArray();
                return rows.map((row, idx) => {
                    const id = String(row['id'] ?? `${tableName}:${idx}`);
                    // LanceDB returns _distance (L2) — convert to a similarity-like score
                    const distance = typeof row['_distance'] === 'number' ? row['_distance'] : 1;
                    const score = 1 / (1 + distance);
                    // Collect all string-valued columns as metadata
                    const metadata = {};
                    for (const [key, val] of Object.entries(row)) {
                        if (key !== 'id' && key !== '_distance' && key !== 'embedding') {
                            metadata[key] = String(val ?? '');
                        }
                    }
                    return { id, score, metadata };
                });
            }
            catch (err) {
                process.stderr.write(`[data-loader] VectorStore search error on table '${tableName}': ${String(err)}\n`);
                return [];
            }
        }
        const store = {
            isAvailable: () => true,
            searchFiles: (emb, k) => searchTable('files', emb, k),
            searchSymbols: (emb, k) => searchTable('symbols', emb, k),
            searchFeatures: (emb, k) => searchTable('features', emb, k),
        };
        return store;
    }
    catch (err) {
        process.stderr.write(`[data-loader] Failed to open VectorStore at ${vectorsDir}: ${String(err)}\n`);
        return null;
    }
}
/**
 * Builds an in-memory BM25 index from the knowledge base.
 *
 * Documents are indexed as:
 *   - 'file:<relPath>'     → llmDescription / detailedPurpose / purpose
 *   - 'symbol:<qualName>' → signature + jsdoc
 *   - 'feature:<id>'      → name + description
 *
 * Returns an empty index (documentCount === 0) when no knowledge data is available.
 */
export function buildBM25IndexFromKnowledge(knowledgeRoot) {
    const bm25 = createBM25Index();
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    // ── File summaries ───────────────────────────────────────────────────────
    const summaries = loadSummaryCache(knowledgeRoot);
    if (summaries) {
        for (const [filePath, summary] of Object.entries(summaries)) {
            const relPath = toRelative(filePath, projectRoot);
            const text = [
                summary.llmDescription ?? '',
                summary.detailedPurpose ?? '',
                summary.purpose ?? '',
                relPath,
                (summary.exports ?? []).join(' '),
            ]
                .filter(Boolean)
                .join(' ');
            if (text.trim()) {
                bm25.addDocument(`file:${relPath}`, text);
            }
        }
    }
    // ── Symbols ──────────────────────────────────────────────────────────────
    const symbols = loadSymbols(knowledgeRoot);
    if (symbols) {
        for (const sym of symbols) {
            const text = [sym.signature, sym.jsdoc ?? '', sym.name].filter(Boolean).join(' ');
            if (text.trim()) {
                bm25.addDocument(`symbol:${sym.qualifiedName}`, text);
            }
        }
    }
    // ── Feature groups ───────────────────────────────────────────────────────
    const features = loadFeatureGroups(knowledgeRoot);
    if (features) {
        for (const feat of features) {
            const text = [
                feat.name,
                feat.description,
                feat.dataFlow,
                feat.keySymbols.join(' '),
            ]
                .filter(Boolean)
                .join(' ');
            if (text.trim()) {
                bm25.addDocument(`feature:${feat.id}`, text);
            }
        }
    }
    return bm25;
}
/**
 * Loads the knowledge graph, using a two-level strategy:
 *
 *  1. Try pre-built files: .knowledge/graph/nodes.json + .knowledge/graph/edges.json
 *     (written by Phase 8 of the build pipeline).
 *  2. Fallback: build in-memory from symbols, dependencies, summaries, and features.
 *
 * Returns null only if neither strategy succeeds (no knowledge data at all).
 * Results are cached per index build timestamp.
 */
export function loadKnowledgeGraph(knowledgeRoot) {
    const index = loadIndex(knowledgeRoot);
    if (!index)
        return null;
    const cacheKey = `knowledge-graph:${knowledgeRoot}`;
    return getOrLoad(cacheKey, () => {
        // ── Strategy 1: pre-built graph files ─────────────────────────────
        const preBuilt = loadGraph(knowledgeRoot);
        if (preBuilt && preBuilt.nodes.length > 0) {
            return preBuilt;
        }
        // ── Strategy 2: build dynamically from existing artifacts ──────────
        const symbols = loadSymbols(knowledgeRoot);
        const deps = loadDependencies(knowledgeRoot);
        const summaries = loadSummaryCache(knowledgeRoot);
        if (!symbols && !deps && !summaries)
            return null;
        const projectRoot = resolveProjectRoot(knowledgeRoot);
        const features = loadFeatureGroups(knowledgeRoot) ?? undefined;
        return buildKnowledgeGraph(symbols ?? [], deps ?? { nodes: [], edges: [], cycles: [], fileDeps: {} }, summaries ?? {}, projectRoot, features);
    }, index.lastBuilt);
}
