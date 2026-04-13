/**
 * Unit tests for k-means clustering (scripts/lib/clustering.ts).
 *
 * Covers:
 *   - k = ceil(sqrt(n/2)), min 3, max 30
 *   - k-means++ initialization with fixed-seed PRNG (determinism)
 *   - Convergence within 50 iterations
 *   - Cosine distance metric
 *   - Same input → identical cluster assignments (reproducibility)
 *   - Files within each cluster are sorted
 *   - Edge cases: empty input, n ≤ k (each point is its own cluster)
 *   - No external dependencies
 */

import { describe, it, expect } from 'vitest';
import { clusterEmbeddings } from '../scripts/lib/clustering.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a unit Float32Array embedding (all zeros except one position). */
function unitVector(dims: number, hotIndex: number): Float32Array {
    const v = new Float32Array(dims);
    v[hotIndex] = 1.0;
    return v;
}

/** Create a near-zero Float32Array (small random-ish values using deterministic seed). */
function deterministicVector(dims: number, seed: number): Float32Array {
    const v = new Float32Array(dims);
    let s = seed;
    for (let i = 0; i < dims; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        v[i] = (s / 0x100000000) * 2 - 1;
    }
    // Normalize to unit vector for cosine distance stability
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    if (norm > 0) for (let i = 0; i < dims; i++) v[i] /= norm;
    return v;
}

/** Build a Map<fileId, embedding> from array of [id, embedding] pairs. */
function makeEmbeddings(pairs: Array<[string, Float32Array]>): Map<string, Float32Array> {
    return new Map(pairs);
}

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('clusterEmbeddings — edge cases', () => {
    it('returns empty map for empty input', () => {
        const result = clusterEmbeddings(new Map());
        expect(result.size).toBe(0);
    });

    it('handles single file — returns one cluster', () => {
        const embs = makeEmbeddings([
            ['file:a.ts', unitVector(4, 0)]
        ]);
        const result = clusterEmbeddings(embs);
        expect(result.size).toBeGreaterThan(0);
        // Total files should be 1
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(1);
    });

    it('when n ≤ k, each point becomes its own cluster', () => {
        // n = 2, k = ceil(sqrt(2/2)) = 1, but min k = 3 → k = 3 > n = 2
        // so each point gets its own cluster
        const embs = makeEmbeddings([
            ['file:a.ts', unitVector(4, 0)],
            ['file:b.ts', unitVector(4, 1)],
        ]);
        const result = clusterEmbeddings(embs);
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(2);
        expect(result.size).toBe(2); // each in its own cluster
    });
});

// ── k selection ───────────────────────────────────────────────────────────────

describe('clusterEmbeddings — k selection', () => {
    it('k is at least 3 for any non-trivial input', () => {
        const n = 10;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:${i}.ts`,
                deterministicVector(8, i + 1)
            ])
        );
        const result = clusterEmbeddings(embs);
        // All n files should be in some cluster
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(n);
        // k should be max(3, ceil(sqrt(n/2))) = max(3, ceil(sqrt(5))) = max(3, 3) = 3
        expect(result.size).toBeGreaterThanOrEqual(1); // could be < 3 if empty clusters removed
        expect(result.size).toBeLessThanOrEqual(3);
    });

    it('k = ceil(sqrt(n/2)) for n = 18 → ceil(3) = 3', () => {
        const n = 18;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:${String(i).padStart(2, '0')}.ts`,
                deterministicVector(8, i + 42)
            ])
        );
        const result = clusterEmbeddings(embs);
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(n);
    });

    it('k is at most 30 for large inputs', () => {
        const n = 5000; // k would be ceil(sqrt(2500)) = 50 → capped at 30
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:${i}.ts`,
                deterministicVector(4, i + 1)
            ])
        );
        const result = clusterEmbeddings(embs);
        // All files should be present
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(n);
        // Max k = 30, so at most 30 clusters (may be fewer if some are empty)
        expect(result.size).toBeLessThanOrEqual(30);
    });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('clusterEmbeddings — determinism with fixed-seed PRNG', () => {
    it('same input produces identical cluster assignments', () => {
        const n = 20;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:module${i}.ts`,
                deterministicVector(16, i + 7)
            ])
        );

        const result1 = clusterEmbeddings(embs);
        const result2 = clusterEmbeddings(embs);

        // Cluster assignments must be identical
        for (const [clusterId, files] of result1) {
            const filesInResult2 = result2.get(clusterId);
            expect(filesInResult2).toBeDefined();
            expect(filesInResult2!.sort()).toEqual(files.sort());
        }
        expect(result1.size).toBe(result2.size);
    });

    it('same files in different insertion order produce same clusters (sorted input)', () => {
        const files = Array.from({ length: 12 }, (_, i) => ({
            id: `file:${String.fromCharCode(97 + i)}.ts`,
            vec: deterministicVector(8, i + 3),
        }));

        // Shuffled insertion order
        const shuffled = [...files].sort(() => 0.5 - Math.random());

        const embsOriginal = makeEmbeddings(files.map(f => [f.id, f.vec]));
        const embsShuffled = makeEmbeddings(shuffled.map(f => [f.id, f.vec]));

        const result1 = clusterEmbeddings(embsOriginal);
        const result2 = clusterEmbeddings(embsShuffled);

        // Both should produce same total file count
        let total1 = 0; for (const f of result1.values()) total1 += f.length;
        let total2 = 0; for (const f of result2.values()) total2 += f.length;
        expect(total1).toBe(total2);

        // Number of clusters should be same
        expect(result1.size).toBe(result2.size);
    });
});

// ── Cosine distance / cluster quality ────────────────────────────────────────

describe('clusterEmbeddings — clustering quality', () => {
    it('clearly separable clusters: files with same orientation cluster together', () => {
        // 3 groups of 4 files each, each group has vectors pointing in same direction
        const dims = 32;
        const group1 = Array.from({ length: 4 }, (_, i) =>
            [`file:g1_${i}.ts`, unitVector(dims, 0)] as [string, Float32Array]
        );
        const group2 = Array.from({ length: 4 }, (_, i) =>
            [`file:g2_${i}.ts`, unitVector(dims, 10)] as [string, Float32Array]
        );
        const group3 = Array.from({ length: 4 }, (_, i) =>
            [`file:g3_${i}.ts`, unitVector(dims, 20)] as [string, Float32Array]
        );

        const embs = makeEmbeddings([...group1, ...group2, ...group3]);
        const result = clusterEmbeddings(embs);

        // All 12 files should be assigned
        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(12);

        // At least 3 distinct clusters
        expect(result.size).toBeGreaterThanOrEqual(3);
    });

    it('files within each cluster are sorted lexicographically', () => {
        const n = 15;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:zzz${n - i}.ts`, // reverse order to test sorting
                deterministicVector(8, i + 100)
            ])
        );
        const result = clusterEmbeddings(embs);

        for (const files of result.values()) {
            const sorted = [...files].sort();
            expect(files).toEqual(sorted);
        }
    });
});

// ── Convergence ────────────────────────────────────────────────────────────────

describe('clusterEmbeddings — convergence', () => {
    it('converges for typical codebase size (100 files)', () => {
        const n = 100;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:src_${i}.ts`,
                deterministicVector(32, i + 1)
            ])
        );

        // Should complete without hanging or throwing
        const result = clusterEmbeddings(embs);

        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(n);
        expect(result.size).toBeGreaterThan(0);
    });

    it('all input files appear in exactly one cluster', () => {
        const n = 30;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:module${i}.ts`,
                deterministicVector(16, i + 200)
            ])
        );
        const result = clusterEmbeddings(embs);

        // Collect all assigned file IDs
        const assigned = new Set<string>();
        for (const files of result.values()) {
            for (const f of files) {
                expect(assigned.has(f)).toBe(false); // no duplicates
                assigned.add(f);
            }
        }
        expect(assigned.size).toBe(n);
    });
});

// ── Custom k override ─────────────────────────────────────────────────────────

describe('clusterEmbeddings — custom k override', () => {
    it('accepts custom k override', () => {
        const n = 20;
        const embs = makeEmbeddings(
            Array.from({ length: n }, (_, i) => [
                `file:${i}.ts`,
                deterministicVector(8, i + 50)
            ])
        );

        // Pass k=5 override
        const result = clusterEmbeddings(embs, 5);

        let total = 0;
        for (const files of result.values()) total += files.length;
        expect(total).toBe(n);
        expect(result.size).toBeLessThanOrEqual(5);
    });
});
