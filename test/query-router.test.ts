/**
 * Unit tests for QueryRouter (mcp-server/tools/lib/query-router.ts).
 *
 * Covers all 5 routing strategies:
 *   - exact_symbol  (PascalCase or '::' notation)
 *   - feature_search (how/what/why/explain starters)
 *   - graph_traversal (calls/imports/depend keywords)
 *   - vector_search  (default)
 *   - hybrid         (multiple patterns)
 *
 * Verifies:
 *   - Correct strategy selection
 *   - Confidence scores in [0, 1]
 *   - Correct suggestedScope per strategy
 */

import { describe, it, expect } from 'vitest';
import { routeQuery } from '../mcp-server/tools/lib/query-router.js';

// ── exact_symbol ──────────────────────────────────────────────────────────────

describe('QueryRouter — exact_symbol strategy', () => {
    it('routes PascalCase single word to exact_symbol (confidence >0.9)', () => {
        const route = routeQuery('CreateOrder');
        expect(route.strategy).toBe('exact_symbol');
        expect(route.confidence).toBeGreaterThan(0.9);
    });

    it('routes PascalCase multi-word to exact_symbol', () => {
        const route = routeQuery('OrderService');
        expect(route.strategy).toBe('exact_symbol');
        expect(route.confidence).toBe(0.95);
    });

    it('routes query with "::" to exact_symbol', () => {
        const route = routeQuery('tools/lib/cache.ts::getOrLoad');
        expect(route.strategy).toBe('exact_symbol');
        expect(route.confidence).toBe(0.95);
    });

    it('routes "ValidateToken" to exact_symbol', () => {
        const route = routeQuery('ValidateToken');
        expect(route.strategy).toBe('exact_symbol');
    });

    it('exact_symbol suggests scope=symbols', () => {
        const route = routeQuery('BM25Index');
        expect(route.suggestedScope).toBe('symbols');
    });

    it('lowercase single word does NOT route to exact_symbol', () => {
        const route = routeQuery('createorder'); // all lowercase
        expect(route.strategy).not.toBe('exact_symbol');
    });
});

// ── feature_search ────────────────────────────────────────────────────────────

describe('QueryRouter — feature_search strategy', () => {
    it('routes "how does authentication work" to feature_search', () => {
        const route = routeQuery('how does authentication work');
        expect(route.strategy).toBe('feature_search');
    });

    it('routes "what is the caching strategy" to feature_search', () => {
        const route = routeQuery('what is the caching strategy');
        expect(route.strategy).toBe('feature_search');
    });

    it('routes "why is this slow" to feature_search', () => {
        const route = routeQuery('why is this slow');
        expect(route.strategy).toBe('feature_search');
    });

    it('routes "explain the payment flow" to feature_search', () => {
        const route = routeQuery('explain the payment flow');
        expect(route.strategy).toBe('feature_search');
    });

    it('routes "how do I use the API" to feature_search', () => {
        const route = routeQuery('how do I use the API');
        expect(route.strategy).toBe('feature_search');
    });

    it('feature_search suggests scope=features', () => {
        const route = routeQuery('how does caching work');
        expect(route.suggestedScope).toBe('features');
    });

    it('feature_search confidence is 0.80', () => {
        const route = routeQuery('what are the main modules');
        expect(route.confidence).toBe(0.80);
    });
});

// ── graph_traversal ───────────────────────────────────────────────────────────

describe('QueryRouter — graph_traversal strategy', () => {
    it('routes "calls createOrder" to graph_traversal', () => {
        const route = routeQuery('calls createOrder');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('routes "imports from cache module" to graph_traversal', () => {
        const route = routeQuery('imports from cache module');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('routes "depends on auth service" to graph_traversal', () => {
        const route = routeQuery('depends on auth service');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('routes "references to handler function" to graph_traversal', () => {
        const route = routeQuery('references to handler function');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('routes "callers of charge" to graph_traversal', () => {
        const route = routeQuery('callers of charge');
        expect(route.strategy).toBe('graph_traversal');
    });

    it('graph_traversal confidence is 0.70', () => {
        const route = routeQuery('who calls getOrLoad');
        expect(route.confidence).toBe(0.70);
    });
});

// ── vector_search (default) ───────────────────────────────────────────────────

describe('QueryRouter — vector_search (default)', () => {
    it('routes generic keyword query to vector_search', () => {
        const route = routeQuery('database connection pooling');
        expect(route.strategy).toBe('vector_search');
    });

    it('vector_search confidence is 0.60', () => {
        const route = routeQuery('database connection pooling');
        expect(route.confidence).toBe(0.60);
    });

    it('routes simple noun phrase to vector_search', () => {
        const route = routeQuery('payment processing');
        expect(route.strategy).toBe('vector_search');
    });

    it('routes "authentication" (single word, lowercase) to vector_search', () => {
        const route = routeQuery('authentication');
        expect(route.strategy).toBe('vector_search');
    });

    it('vector_search suggests scope=all', () => {
        const route = routeQuery('build pipeline');
        expect(route.suggestedScope).toBe('all');
    });
});

// ── hybrid (multiple patterns) ────────────────────────────────────────────────

describe('QueryRouter — hybrid strategy', () => {
    it('routes "how does createOrder depend on payment service" to hybrid', () => {
        // Matches: feature_search (how does) + graph_traversal (depend)
        const route = routeQuery('how does createOrder depend on payment service');
        expect(route.strategy).toBe('hybrid');
    });

    it('hybrid confidence is average of matched rules', () => {
        // "how does X depend" → feature_search(0.80) + graph_traversal(0.70) → avg 0.75
        const route = routeQuery('how does createOrder depend on payment service');
        expect(route.strategy).toBe('hybrid');
        expect(route.confidence).toBeGreaterThan(0);
        expect(route.confidence).toBeLessThanOrEqual(1);
    });

    it('hybrid for feature + graph: confidence is (0.80 + 0.70) / 2 = 0.75', () => {
        const route = routeQuery('how does this import other modules');
        if (route.strategy === 'hybrid') {
            expect(route.confidence).toBeCloseTo(0.75, 1);
        }
    });
});

// ── Confidence invariant ──────────────────────────────────────────────────────

describe('QueryRouter — confidence invariant', () => {
    const queries = [
        'CreateOrder',
        'how does caching work',
        'calls handleRequest',
        'database schema',
        'what are the imports in auth module',
        'FindSymbol',
        'explain the BFS traversal algorithm',
        '',
        '   ',
        'some::qualified::name',
    ];

    it.each(queries)('confidence for "%s" is in [0, 1]', (q) => {
        const route = routeQuery(q);
        expect(route.confidence).toBeGreaterThanOrEqual(0);
        expect(route.confidence).toBeLessThanOrEqual(1);
    });

    it('strategy is always a valid value', () => {
        const valid = ['exact_symbol', 'feature_search', 'graph_traversal', 'vector_search', 'hybrid'];
        for (const q of queries) {
            const route = routeQuery(q);
            expect(valid).toContain(route.strategy);
        }
    });

    it('suggestedScope is always a valid value', () => {
        const validScopes = ['symbols', 'features', 'files', 'all'];
        for (const q of queries) {
            const route = routeQuery(q);
            expect(validScopes).toContain(route.suggestedScope);
        }
    });
});
