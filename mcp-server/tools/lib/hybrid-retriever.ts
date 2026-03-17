/**
 * HybridRetriever — combines BM25 keyword search with ANN vector search
 * using Reciprocal Rank Fusion (RRF, k=60).
 *
 * RRF formula: RRFscore(d) = Σ 1 / (k + rank_i(d))
 *   where rank_i(d) is the 1-based rank of document d in ranking i.
 *
 * Scope filtering:
 *   'files'    → search files.lance only
 *   'symbols'  → search symbols.lance only
 *   'features' → search features.lance only
 *   'all'      → search all three tables and merge
 */

import type { HybridSearchResult, VectorSearchResult, BM25Result } from '../../types.js';
import type { BM25Index } from './bm25-index.js';
import type { EmbeddingProvider } from './embedding-provider.js';

// Re-export for consumers
export type { HybridSearchResult };

/** Minimal read-only VectorStore interface required at search time. */
export interface VectorStore {
    searchFiles(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
    searchSymbols(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
    searchFeatures(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
    isAvailable(): boolean;
}

type SearchScope = 'files' | 'symbols' | 'features' | 'all';

/**
 * Pure RRF merge of multiple ranked lists.
 *
 * @param rankings  Each element is a ranked list of {id, rank} pairs (rank is 1-based).
 * @param k         RRF constant (default 60, as recommended by the original paper).
 * @returns         Merged list sorted by descending RRF score.
 */
export function reciprocalRankFusion(
    rankings: Array<Array<{ id: string; rank: number }>>,
    k = 60
): Array<{ id: string; score: number }> {
    const scores = new Map<string, number>();

    for (const ranking of rankings) {
        for (const { id, rank } of ranking) {
            scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
        }
    }

    return [...scores.entries()]
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);
}

/**
 * Convert an array of results (already sorted descending by score) into a
 * ranked list suitable for reciprocalRankFusion().
 */
function toRanked(
    results: Array<{ id: string }>
): Array<{ id: string; rank: number }> {
    return results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

/**
 * Build a metadata lookup map from vector search results.
 */
function buildMetaMap(results: VectorSearchResult[]): Map<string, Record<string, string>> {
    const map = new Map<string, Record<string, string>>();
    for (const r of results) {
        map.set(r.id, r.metadata);
    }
    return map;
}

/**
 * Perform hybrid BM25 + ANN vector search with RRF merging.
 *
 * @param query             Natural-language search query
 * @param scope             Which index tables to search
 * @param topK              Maximum number of results to return (1-50)
 * @param vectorStore       LanceDB-backed vector store (must be isAvailable())
 * @param bm25              In-memory BM25 index pre-populated from knowledge data
 * @param embeddingProvider Provider used to embed the query string
 * @returns                 Top-K merged results sorted by RRF score
 */
export async function hybridSearch(
    query: string,
    scope: SearchScope,
    topK: number,
    vectorStore: VectorStore,
    bm25: BM25Index,
    embeddingProvider: EmbeddingProvider
): Promise<HybridSearchResult[]> {
    // Embed the query once — used for all vector searches
    const [queryEmbedding] = await embeddingProvider.embed([query]);

    // ── BM25 search ──────────────────────────────────────────────────────────
    // BM25 is scope-agnostic at this layer; scope filtering is applied below
    // based on id prefixes set during indexing ('file:', 'symbol:', 'feature:')
    const bm25Raw: BM25Result[] = bm25.search(query, topK * 3);

    // ── Vector search (scope-filtered) ──────────────────────────────────────
    const vectorFetch = topK * 2;
    const vectorResults: VectorSearchResult[] = [];

    if (scope === 'files' || scope === 'all') {
        const r = await vectorStore.searchFiles(queryEmbedding, vectorFetch);
        vectorResults.push(...r);
    }
    if (scope === 'symbols' || scope === 'all') {
        const r = await vectorStore.searchSymbols(queryEmbedding, vectorFetch);
        vectorResults.push(...r);
    }
    if (scope === 'features' || scope === 'all') {
        const r = await vectorStore.searchFeatures(queryEmbedding, vectorFetch);
        vectorResults.push(...r);
    }

    // ── Scope-filter BM25 results ─────────────────────────────────────────
    const scopePrefixes: string[] = [];
    if (scope === 'files' || scope === 'all') scopePrefixes.push('file:');
    if (scope === 'symbols' || scope === 'all') scopePrefixes.push('symbol:');
    if (scope === 'features' || scope === 'all') scopePrefixes.push('feature:');

    const bm25Filtered =
        scope === 'all'
            ? bm25Raw
            : bm25Raw.filter((r) => scopePrefixes.some((p) => r.id.startsWith(p)));

    // ── RRF merge ─────────────────────────────────────────────────────────
    const rankings: Array<Array<{ id: string; rank: number }>> = [];
    if (bm25Filtered.length > 0) rankings.push(toRanked(bm25Filtered));
    if (vectorResults.length > 0) rankings.push(toRanked(vectorResults));

    if (rankings.length === 0) return [];

    const merged = reciprocalRankFusion(rankings);

    // Build metadata lookup from vector results
    const metaMap = buildMetaMap(vectorResults);

    // Determine source annotation for each result
    const bm25Ids = new Set(bm25Filtered.map((r) => r.id));
    const vecIds = new Set(vectorResults.map((r) => r.id));

    const output: HybridSearchResult[] = merged.slice(0, topK).map(({ id, score }) => {
        const inBm25 = bm25Ids.has(id);
        const inVec = vecIds.has(id);
        const source: HybridSearchResult['source'] =
            inBm25 && inVec ? 'hybrid' : inVec ? 'vector' : 'bm25';

        return {
            id,
            score,
            source,
            metadata: metaMap.get(id) ?? {},
        };
    });

    return output;
}
