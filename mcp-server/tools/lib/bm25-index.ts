/**
 * BM25 keyword search index — zero-dependency implementation.
 *
 * Tokenization handles:
 *   - camelCase:  "buildCallGraph" → ["build", "call", "graph"]
 *   - snake_case: "extract_deps"   → ["extract", "deps"]
 *   - dot notation: "obj.method"   → ["obj", "method"]
 *
 * BM25 formula: score(D,q) = Σ IDF(qi) * (f(qi,D)*(k1+1)) / (f(qi,D) + k1*(1-b+b*|D|/avgdl))
 * Parameters: k1=1.5, b=0.75
 */

import type { BM25Result } from '../../types.js';

/** Split camelCase/PascalCase, snake_case, and dot notation into lowercase tokens. */
function tokenize(text: string): string[] {
    // Insert space before each uppercase letter that follows a lowercase letter or digit
    // e.g. "buildCallGraph" → "build Call Graph"
    const withCamelSplits = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

    // Replace underscores and dots with spaces
    const normalized = withCamelSplits.replace(/[_./\\-]/g, ' ');

    // Split on non-alphanumeric boundaries, lowercase, filter empties
    return normalized
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 0);
}

interface DocEntry {
    tokens: string[];
    length: number;
    /** term → frequency within this document (built lazily on first search) */
    tf: Map<string, number> | null;
}

/** BM25 in-memory index. Documents are identified by a string id. */
export class BM25Index {
    private readonly k1 = 1.5;
    private readonly b = 0.75;

    private docs = new Map<string, DocEntry>();
    /** document frequency per term */
    private df = new Map<string, number>();
    private totalLength = 0;

    /**
     * Add or replace a document. If the id already exists the old entry is
     * removed first so re-indexing is idempotent.
     */
    addDocument(id: string, text: string): void {
        // Remove old entry if re-indexing
        const old = this.docs.get(id);
        if (old) {
            this.totalLength -= old.length;
            // Decrement document frequencies for old terms
            const oldTerms = new Set(old.tokens);
            for (const term of oldTerms) {
                const prev = this.df.get(term) ?? 1;
                if (prev <= 1) {
                    this.df.delete(term);
                } else {
                    this.df.set(term, prev - 1);
                }
            }
        }

        const tokens = tokenize(text);
        this.docs.set(id, { tokens, length: tokens.length, tf: null });
        this.totalLength += tokens.length;

        // Update document frequencies
        const seen = new Set<string>();
        for (const token of tokens) {
            if (!seen.has(token)) {
                this.df.set(token, (this.df.get(token) ?? 0) + 1);
                seen.add(token);
            }
        }
    }

    /** Return top-K results by BM25 score, sorted descending. */
    search(query: string, topK: number): BM25Result[] {
        const n = this.docs.size;
        if (n === 0) return [];

        const avgdl = this.totalLength / n;
        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        const scores = new Map<string, number>();
        const { k1, b } = this;

        for (const qt of queryTokens) {
            const df = this.df.get(qt) ?? 0;
            if (df === 0) continue;

            // IDF with +1 smoothing to avoid negatives
            const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);

            for (const [docId, doc] of this.docs) {
                // Build TF map lazily
                if (doc.tf === null) {
                    doc.tf = new Map<string, number>();
                    for (const t of doc.tokens) {
                        doc.tf.set(t, (doc.tf.get(t) ?? 0) + 1);
                    }
                }
                const tf = doc.tf.get(qt) ?? 0;
                if (tf === 0) continue;

                const norm = k1 * (1 - b + b * (doc.length / avgdl));
                const termScore = idf * (tf * (k1 + 1)) / (tf + norm);
                scores.set(docId, (scores.get(docId) ?? 0) + termScore);
            }
        }

        return [...scores.entries()]
            .map(([id, score]) => ({ id, score }))
            .sort((a, c) => c.score - a.score)
            .slice(0, topK);
    }

    /** Remove all documents from the index. */
    clear(): void {
        this.docs.clear();
        this.df.clear();
        this.totalLength = 0;
    }

    /** Number of documents currently indexed. */
    documentCount(): number {
        return this.docs.size;
    }
}

/** Factory function following project patterns. */
export function createBM25Index(): BM25Index {
    return new BM25Index();
}
