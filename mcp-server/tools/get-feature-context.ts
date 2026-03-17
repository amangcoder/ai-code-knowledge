/**
 * get_feature_context MCP tool — semantic feature group lookup.
 *
 * Flow:
 *  1. Parse and validate args (query required, topK default 3, capped at 20)
 *  2. Load KnowledgeIndex (required for buildTimestamp cache key)
 *  3. Check WorkingMemory cache → return cached result if hit
 *  4. Load feature groups via data-loader
 *  5. If features unavailable → return guidance message
 *  6. Load VectorStore; generate query embedding via EmbeddingProvider
 *  7. Search features.lance for top-K results (or fall back to BM25 substring
 *     ranking when VectorStore is unavailable)
 *  8. Resolve vector result IDs → FeatureGroup objects
 *  9. Format each result: name, description, files, entryPoints, dataFlow,
 *     keySymbols, relatedFeatures
 * 10. Cache result in WorkingMemory
 * 11. Build response via buildResponse() respecting 20 KB budget
 */

import type { CallToolResult, FeatureGroup } from '../types.js';
import { loadIndex, loadFeatureGroups, loadVectorStore } from './lib/data-loader.js';
import { buildResponse, type Section } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';
import { resolveProjectRoot } from './lib/path-utils.js';
import { getFromMemory, setInMemory } from './lib/working-memory.js';
import { createEmbeddingProvider } from './lib/embedding-provider.js';

export interface GetFeatureContextArgs {
    query: string;
    topK?: number;
}

export type { GetFeatureContextArgs };

const TOOL_BUDGET = 20_000; // 20 KB
const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 20;

/** Build a deterministic WorkingMemory cache key for a query+topK tuple. */
function buildCacheKey(knowledgeRoot: string, query: string, topK: number): string {
    return `get_feature_context:${knowledgeRoot}:${topK}:${query}`;
}

/**
 * Format a single FeatureGroup into a human-readable block.
 * Always includes all required fields from the FeatureGroup schema.
 */
function formatFeature(feature: FeatureGroup, rank: number): string {
    const lines: string[] = [];

    lines.push(`${rank}. ${feature.name}`);
    lines.push(`   ID: ${feature.id}`);

    if (feature.description) {
        lines.push(`   Description: ${feature.description}`);
    }

    if (feature.files.length > 0) {
        lines.push(`   Files (${feature.files.length}):`);
        for (const f of feature.files) {
            lines.push(`     - ${f}`);
        }
    } else {
        lines.push(`   Files: (none)`);
    }

    if (feature.entryPoints.length > 0) {
        lines.push(`   Entry Points: ${feature.entryPoints.join(', ')}`);
    } else {
        lines.push(`   Entry Points: (none)`);
    }

    if (feature.dataFlow) {
        lines.push(`   Data Flow: ${feature.dataFlow}`);
    } else {
        lines.push(`   Data Flow: (not specified)`);
    }

    if (feature.keySymbols.length > 0) {
        lines.push(`   Key Symbols: ${feature.keySymbols.join(', ')}`);
    } else {
        lines.push(`   Key Symbols: (none)`);
    }

    if (feature.relatedFeatures.length > 0) {
        lines.push(`   Related Features: ${feature.relatedFeatures.join(', ')}`);
    } else {
        lines.push(`   Related Features: (none)`);
    }

    return lines.join('\n');
}

/**
 * Rank features via simple word-overlap when VectorStore is unavailable.
 *
 * Counts how many query words appear in the concatenated name+description of
 * each feature. Features with zero matches are included last (ordered by index)
 * so the caller always gets topK results rather than an empty list.
 */
function rankFeaturesByKeyword(
    features: FeatureGroup[],
    query: string,
    topK: number
): FeatureGroup[] {
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = features.map((f) => {
        const haystack = `${f.name} ${f.description}`.toLowerCase();
        const hits = queryWords.filter((w) => haystack.includes(w)).length;
        return { feature: f, hits };
    });

    // Sort: more hits first; ties preserve original order (stable sort)
    scored.sort((a, b) => b.hits - a.hits);

    return scored.slice(0, topK).map((x) => x.feature);
}

/**
 * Handler for the `get_feature_context` MCP tool.
 *
 * Performs a semantic search over discovered feature groups and returns
 * rich context for each matched feature: name, description, files,
 * entry points, data flow description, key symbols, and related features.
 */
export async function handler(
    args: GetFeatureContextArgs,
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
    const cacheKey = buildCacheKey(knowledgeRoot, query, topK);
    const cached = getFromMemory<CallToolResult>(cacheKey, buildTimestamp);
    if (cached) {
        return cached;
    }

    // ── 4. Load feature groups via data-loader ───────────────────────────────
    const features = loadFeatureGroups(knowledgeRoot);

    // ── 5. If features unavailable → guidance message ─────────────────────────
    if (!features) {
        const noFeaturesMsg = [
            `Feature context not available for query: "${query}"`,
            '',
            'Feature groups have not been discovered for this project.',
            'Feature discovery (Phase 9) requires the embedding phase (Phase 7) to run first.',
            '',
            'Run: npm run build-knowledge',
            '',
            'Alternative: use semantic_search(scope="features") if vectors are available,',
            '  or search_architecture() for documentation-level search.',
        ].join('\n');

        return {
            content: [{ type: 'text', text: noFeaturesMsg }],
            isError: false,
        };
    }

    if (features.length === 0) {
        const emptyMsg = [
            `No feature groups found for query: "${query}"`,
            '',
            'The knowledge base was built, but no feature groups were discovered.',
            'This typically happens with very small codebases (fewer than ~5 files).',
            '',
            'Alternative: use semantic_search() or search_architecture() instead.',
        ].join('\n');

        return {
            content: [{ type: 'text', text: emptyMsg }],
            isError: false,
        };
    }

    // ── 6. Try VectorStore search; fall back to keyword ranking ─────────────
    let rankedFeatures: FeatureGroup[];
    let searchMethod: 'vector' | 'keyword' = 'keyword';

    const vectorStore = await loadVectorStore(knowledgeRoot);

    if (vectorStore && vectorStore.isAvailable()) {
        // Create embedding provider
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

        // Generate query embedding
        let queryEmbedding: number[];
        try {
            [queryEmbedding] = await embeddingProvider.embed([query]);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
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
                content: [{ type: 'text', text: `Embedding error: ${message}` }],
                isError: true,
            };
        }

        // Search features.lance for top-K results
        const vectorResults = await vectorStore.searchFeatures(queryEmbedding, topK);

        // Build a map of featureId → FeatureGroup for O(1) lookup
        const featureMap = new Map<string, FeatureGroup>();
        for (const f of features) {
            featureMap.set(f.id, f);
        }

        // Map vector result IDs → FeatureGroup objects (strip 'feature:' prefix)
        const resolved: FeatureGroup[] = [];
        const seen = new Set<string>();
        for (const vr of vectorResults) {
            const featureId = vr.id.startsWith('feature:')
                ? vr.id.slice('feature:'.length)
                : vr.id;

            if (!seen.has(featureId)) {
                seen.add(featureId);
                const feature = featureMap.get(featureId);
                if (feature) {
                    resolved.push(feature);
                }
            }
        }

        rankedFeatures = resolved;
        searchMethod = 'vector';
    } else {
        // Graceful degradation: keyword-based ranking
        rankedFeatures = rankFeaturesByKeyword(features, query, topK);
        searchMethod = 'keyword';
    }

    // ── 7. Build response sections ───────────────────────────────────────────
    const sections: Section[] = [];
    const projectRoot = resolveProjectRoot(knowledgeRoot);

    const searchLabel =
        searchMethod === 'vector' ? 'semantic vector search' : 'keyword matching (vector index unavailable)';

    const headerText =
        rankedFeatures.length === 0
            ? `No feature groups matched: "${query}"`
            : `Found ${rankedFeatures.length} feature group${rankedFeatures.length !== 1 ? 's' : ''} for: "${query}" (topK=${topK}, via ${searchLabel})`;

    sections.push({ label: '', content: headerText, priority: 0 });

    if (rankedFeatures.length === 0) {
        const noMatchContent = [
            '',
            'Suggestions:',
            '  - Try a broader query or different keywords',
            '  - Use semantic_search(scope="features") for broader results',
            '  - Run build-knowledge to rebuild feature groups',
        ].join('\n');
        sections.push({ label: 'No Matches', content: noMatchContent, priority: 1 });
    } else {
        const resultLines = rankedFeatures.map((f, i) => formatFeature(f, i + 1));
        sections.push({
            label: `Feature Groups (${rankedFeatures.length})`,
            content: resultLines.join('\n\n'),
            priority: 1,
        });
    }

    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));

    // ── 8. Build response respecting 20 KB budget ────────────────────────────
    const text = buildResponse(sections, TOOL_BUDGET);
    const result: CallToolResult = { content: [{ type: 'text', text }] };

    // ── 9. Cache in WorkingMemory ─────────────────────────────────────────────
    setInMemory(cacheKey, result, buildTimestamp);

    return result;
}
