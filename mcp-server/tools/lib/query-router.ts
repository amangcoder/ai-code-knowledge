/**
 * QueryRouter — classifies natural-language queries into optimal retrieval
 * strategies without requiring manual strategy selection from the caller.
 *
 * Heuristics (in priority order):
 *   PascalCase identifier OR '::' → exact_symbol  (confidence 0.95)
 *   starts with how/what/why/explain → feature_search (confidence 0.80)
 *   contains call/import/depend/reference → graph_traversal (confidence 0.70)
 *   multiple patterns matched → hybrid (avg confidence)
 *   default → vector_search (confidence 0.60)
 */

import type { QueryRoute } from '../../types.js';

// Re-export for consumers that only import from this module.
export type { QueryRoute };

/**
 * Analyse a query and return the best retrieval strategy, a confidence score
 * in [0, 1], and a suggested search scope.
 */
export function routeQuery(query: string): QueryRoute {
    const trimmed = query.trim();

    interface Match {
        strategy: QueryRoute['strategy'];
        confidence: number;
        suggestedScope: QueryRoute['suggestedScope'];
    }

    const matches: Match[] = [];

    // ── Rule 1: PascalCase single identifier or '::' qualified name ─────────
    // e.g. "CreateOrder", "OrderService", "tools/lib/cache.ts::getOrLoad"
    if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed) || trimmed.includes('::')) {
        matches.push({ strategy: 'exact_symbol', confidence: 0.95, suggestedScope: 'symbols' });
    }

    // ── Rule 2: Natural-language question starters ───────────────────────────
    if (/^(how does|how do|how is|what is|what are|what does|why does|why is|explain)\b/i.test(trimmed)) {
        matches.push({ strategy: 'feature_search', confidence: 0.80, suggestedScope: 'features' });
    }

    // ── Rule 3: Dependency / call-graph query ────────────────────────────────
    if (/\b(call[s]?|import[s]?|depend[s]?|dependenc|reference[s]?|caller[s]?|callee[s]?)\b/i.test(trimmed)) {
        matches.push({ strategy: 'graph_traversal', confidence: 0.70, suggestedScope: 'all' });
    }

    // ── Resolution ───────────────────────────────────────────────────────────
    if (matches.length === 0) {
        return { strategy: 'vector_search', confidence: 0.60, suggestedScope: 'all' };
    }

    if (matches.length === 1) {
        return matches[0];
    }

    // Multiple rules fired → hybrid, average confidence
    const avgConfidence =
        matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length;

    return {
        strategy: 'hybrid',
        confidence: Math.min(1, avgConfidence),
        suggestedScope: 'all',
    };
}
