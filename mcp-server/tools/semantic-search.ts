/**
 * semantic_search MCP tool — hybrid BM25 + ANN vector search with RRF.
 *
 * Flow:
 *  1. Parse and validate args (query, scope='all', topK=10 capped at 50)
 *  2. Load KnowledgeIndex (required for buildTimestamp cache key)
 *  3. Check WorkingMemory cache → return cached result if hit
 *  4. Build BM25 index from knowledge data (summaries + symbols + features)
 *  5. Load VectorStore via data-loader
 *  6. If VectorStore unavailable → return guidance message
 *  7. Create EmbeddingProvider via factory
 *  8. Use QueryRouter to refine scope hint
 *  9. Call hybridSearch() with effective scope
 * 10. Resolve result metadata into human-readable snippets
 * 11. Cache result in WorkingMemory
 * 12. Build response via buildResponse() respecting 14 KB budget
 */

import type { CallToolResult, SemanticSearchArgs } from '../types.js';
import { loadIndex, loadSummaryCache, loadSymbols, loadVectorStore, buildBM25IndexFromKnowledge } from './lib/data-loader.js';
import { buildResponse, type Section } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';
import { resolveProjectRoot, toRelative } from './lib/path-utils.js';
import { getFromMemory, setInMemory } from './lib/working-memory.js';
import { routeQuery } from './lib/query-router.js';
import { createEmbeddingProvider } from './lib/embedding-provider.js';
import { hybridSearch, type HybridSearchResult } from './lib/hybrid-retriever.js';

export type { SemanticSearchArgs };

const TOOL_BUDGET = 14_000; // 14 KB
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;
const SNIPPET_MAX_LEN = 300;

/** Build a deterministic WorkingMemory cache key for a query+scope+topK tuple. */
function buildCacheKey(
    knowledgeRoot: string,
    query: string,
    scope: string,
    topK: number
): string {
    return `semantic_search:${knowledgeRoot}:${scope}:${topK}:${query}`;
}

/** Truncate a string to maxLen, appending '…' if truncated. */
function truncate(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
}

/**
 * Resolves a hybrid search result into a human-readable display entry.
 *
 * id format from buildBM25IndexFromKnowledge:
 *   'file:<relPath>'      → file result
 *   'symbol:<qualName>'  → symbol result
 *   'feature:<id>'       → feature result
 *
 * Vector store results carry arbitrary metadata; we surface whatever is
 * available in metadata + fall back to a minimal label.
 */
function formatResult(
    result: HybridSearchResult,
    summaries: Record<string, string> | null,
    symbolSnippets: Map<string, string>,
    featureSnippets: Map<string, string>,
    index: number
): string {
    const scoreStr = result.score.toFixed(4);
    const sourceLabel =
        result.source === 'hybrid'
            ? 'BM25+Vector'
            : result.source === 'vector'
            ? 'Vector'
            : 'BM25';

    const lines: string[] = [];
    lines.push(`${index + 1}. [${sourceLabel}] score=${scoreStr}`);

    const { id, metadata } = result;

    if (id.startsWith('file:')) {
        const relPath = id.slice('file:'.length);
        lines.push(`   Type: file`);
        lines.push(`   Path: ${relPath}`);

        // Prefer metadata (from vector store) then fall back to summaries cache
        const desc =
            metadata['purpose'] ??
            metadata['llmDescription'] ??
            metadata['detailedPurpose'] ??
            summaries?.[relPath] ??
            '';
        if (desc) lines.push(`   Summary: ${truncate(desc, SNIPPET_MAX_LEN)}`);

    } else if (id.startsWith('symbol:')) {
        const qualName = id.slice('symbol:'.length);
        lines.push(`   Type: symbol`);
        lines.push(`   Symbol: ${qualName}`);

        const sig =
            metadata['signature'] ??
            symbolSnippets.get(qualName) ??
            '';
        if (sig) lines.push(`   Signature: ${truncate(sig, SNIPPET_MAX_LEN)}`);

        const file = metadata['file'] ?? '';
        if (file) lines.push(`   File: ${file}`);

    } else if (id.startsWith('feature:')) {
        const featureId = id.slice('feature:'.length);
        lines.push(`   Type: feature`);
        lines.push(`   Feature: ${featureId}`);

        const desc =
            metadata['name']
                ? `${metadata['name']}: ${metadata['description'] ?? ''}`
                : featureSnippets.get(featureId) ?? '';
        if (desc) lines.push(`   Description: ${truncate(desc, SNIPPET_MAX_LEN)}`);

    } else {
        // Unknown prefix — surface raw id and any metadata
        lines.push(`   ID: ${id}`);
        for (const [k, v] of Object.entries(metadata)) {
            if (v) lines.push(`   ${k}: ${truncate(v, 120)}`);
        }
    }

    return lines.join('\n');
}

/**
 * Builds lookup maps for symbol signatures and feature descriptions
 * from the in-memory knowledge data for use in formatResult().
 */
function buildSnippetMaps(knowledgeRoot: string): {
    symbolSnippets: Map<string, string>;
    featureSnippets: Map<string, string>;
    summarySnippets: Record<string, string> | null;
} {
    const symbolSnippets = new Map<string, string>();
    const featureSnippets = new Map<string, string>();

    const symbols = loadSymbols(knowledgeRoot);
    if (symbols) {
        for (const sym of symbols) {
            symbolSnippets.set(sym.qualifiedName, sym.signature ?? '');
        }
    }

    // Summary snippets keyed by relPath
    let summarySnippets: Record<string, string> | null = null;
    const cache = loadSummaryCache(knowledgeRoot);
    if (cache) {
        summarySnippets = {};
        const projectRoot = resolveProjectRoot(knowledgeRoot);
        for (const [filePath, s] of Object.entries(cache)) {
            const relPath = toRelative(filePath, projectRoot);
            summarySnippets[relPath] =
                s.llmDescription ?? s.detailedPurpose ?? s.purpose ?? '';
        }
    }

    return { symbolSnippets, featureSnippets, summarySnippets };
}

/**
 * Handler for the `semantic_search` MCP tool.
 *
 * Performs hybrid BM25 + ANN vector search over the knowledge base,
 * merged via Reciprocal Rank Fusion, and returns ranked results with
 * relevance scores, snippets, and metadata.
 */
export async function handler(
    args: SemanticSearchArgs,
    knowledgeRoot: string = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge'
): Promise<CallToolResult> {
    // ── 1. Validate inputs ───────────────────────────────────────────────────
    const query = (args.query ?? '').trim();
    if (!query) {
        return {
            content: [{ type: 'text', text: 'query parameter is required and must not be empty.' }],
            isError: true,
        };
    }

    const scope = args.scope ?? 'all';
    const validScopes = ['files', 'symbols', 'features', 'all'] as const;
    if (!validScopes.includes(scope as typeof validScopes[number])) {
        return {
            content: [{ type: 'text', text: `Invalid scope "${scope}". Valid values: files, symbols, features, all.` }],
            isError: true,
        };
    }

    const rawTopK = args.topK ?? DEFAULT_TOP_K;
    const topK = Math.max(1, Math.min(MAX_TOP_K, Math.floor(rawTopK)));

    // ── 2. Load knowledge index (needed for buildTimestamp) ──────────────────
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        return {
            content: [{
                type: 'text',
                text: [
                    'Knowledge base not found. The knowledge index has not been built for this project.',
                    '',
                    'Run: npm run build-knowledge',
                ].join('\n'),
            }],
            isError: true,
        };
    }

    const buildTimestamp = index.lastBuilt;

    // ── 3. Check WorkingMemory cache ─────────────────────────────────────────
    const cacheKey = buildCacheKey(knowledgeRoot, query, scope, topK);
    const cached = getFromMemory<CallToolResult>(cacheKey, buildTimestamp);
    if (cached) {
        return cached;
    }

    // ── 4. Build BM25 index from knowledge data ──────────────────────────────
    const bm25 = buildBM25IndexFromKnowledge(knowledgeRoot);

    // ── 5. Load VectorStore ──────────────────────────────────────────────────
    const vectorStore = await loadVectorStore(knowledgeRoot);

    // ── 6. If VectorStore unavailable → guidance message ─────────────────────
    if (!vectorStore || !vectorStore.isAvailable()) {
        const bm25Count = bm25.documentCount();
        const noVectorMsg = [
            `Vector index not available for query: "${query}"`,
            '',
            'The semantic vector index has not been built yet.',
            'Run the following command to generate embeddings:',
            '',
            '  npm run build-knowledge',
            '',
            bm25Count > 0
                ? `Note: BM25 keyword index is available (${bm25Count} documents). ` +
                  'For keyword-based search, try search_architecture() or find_symbol().'
                : 'Run build-knowledge first to enable both vector and keyword search.',
        ].join('\n');

        return {
            content: [{ type: 'text', text: noVectorMsg }],
            isError: false,
        };
    }

    // ── 7. Create EmbeddingProvider ──────────────────────────────────────────
    let embeddingProvider;
    try {
        embeddingProvider = createEmbeddingProvider();
    } catch (err) {
        return {
            content: [{
                type: 'text',
                text: [
                    'Failed to create embedding provider.',
                    String(err instanceof Error ? err.message : err),
                    '',
                    'Set EMBEDDING_MODEL=ollama (default) or EMBEDDING_MODEL=openai with OPENAI_API_KEY.',
                ].join('\n'),
            }],
            isError: true,
        };
    }

    // ── 8. QueryRouter — refine effective scope ──────────────────────────────
    const route = routeQuery(query);
    // If the caller didn't explicitly set scope and the router is confident, use it
    const effectiveScope =
        args.scope !== undefined
            ? scope
            : route.confidence >= 0.75 && route.suggestedScope !== 'all'
            ? route.suggestedScope
            : scope;

    // ── 9. Hybrid search ─────────────────────────────────────────────────────
    let results: HybridSearchResult[];
    try {
        results = await hybridSearch(
            query,
            effectiveScope as 'files' | 'symbols' | 'features' | 'all',
            topK,
            vectorStore,
            bm25,
            embeddingProvider
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Surface embedding connectivity errors gracefully
        const isConnectError =
            message.includes('ECONNREFUSED') ||
            message.includes('fetch failed') ||
            message.includes('not reachable');

        if (isConnectError) {
            return {
                content: [{
                    type: 'text',
                    text: [
                        `Could not connect to the embedding provider: ${message}`,
                        '',
                        'Ensure Ollama is running (default) or set EMBEDDING_MODEL=openai with OPENAI_API_KEY.',
                    ].join('\n'),
                }],
                isError: true,
            };
        }

        return {
            content: [{
                type: 'text',
                text: `Hybrid search error: ${message}`,
            }],
            isError: true,
        };
    }

    // ── 10. Format results ───────────────────────────────────────────────────
    const { symbolSnippets, featureSnippets, summarySnippets } =
        buildSnippetMaps(knowledgeRoot);

    const projectRoot = resolveProjectRoot(knowledgeRoot);

    const sections: Section[] = [];

    // Header
    const scopeNote =
        effectiveScope !== scope ? ` (scope auto-refined to '${effectiveScope}' via QueryRouter)` : '';
    const headerText = results.length === 0
        ? `No results found for: "${query}"`
        : `Found ${results.length} result${results.length !== 1 ? 's' : ''} for: "${query}" (scope=${effectiveScope}, topK=${topK})${scopeNote}`;

    sections.push({ label: '', content: headerText, priority: 0 });

    if (results.length === 0) {
        const noResultsContent = [
            '',
            'Suggestions:',
            '  - Try a broader query or different keywords',
            '  - Use scope="all" to search across all result types',
            '  - Try find_symbol() for exact symbol name lookup',
            '  - Try search_architecture() for documentation search',
        ].join('\n');
        sections.push({ label: 'No Results', content: noResultsContent, priority: 1 });
    } else {
        // Strategy info
        const strategyContent = `Query strategy: ${route.strategy} (confidence=${route.confidence.toFixed(2)})`;
        sections.push({ label: 'Search Strategy', content: strategyContent, priority: 1 });

        // Results section
        const resultLines = results.map((r, i) =>
            formatResult(r, summarySnippets, symbolSnippets, featureSnippets, i)
        );
        sections.push({
            label: `Results (${results.length})`,
            content: resultLines.join('\n\n'),
            priority: 2,
        });
    }

    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));

    // ── 11. Build response ───────────────────────────────────────────────────
    const text = buildResponse(sections, TOOL_BUDGET);
    const result: CallToolResult = { content: [{ type: 'text', text }] };

    // ── 12. Cache in WorkingMemory ────────────────────────────────────────────
    setInMemory(cacheKey, result, buildTimestamp);

    return result;
}
