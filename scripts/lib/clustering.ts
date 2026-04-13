/**
 * k-means clustering for feature discovery.
 *
 * Algorithm: k-means++ initialization, cosine distance metric.
 * k = ceil(sqrt(n / 2)), min 3, max 30.
 * Fixed-seed PRNG for reproducibility.
 * Max 50 iterations or convergence (centroid delta < 1e-6).
 *
 * No external dependencies.
 */

// ── PRNG (xorshift32, seeded from file path hash) ────────────────────────────

function hashSeed(keys: string[]): number {
    // Simple djb2-style hash of sorted key list
    const str = [...keys].sort().join('\0');
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h || 1; // avoid seed=0
}

function makeRNG(seed: number): () => number {
    let s = seed >>> 0;
    return function xorshift32() {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        s = s >>> 0;
        return s / 0x100000000;
    };
}

// ── Vector math (cosine distance) ─────────────────────────────────────────────

/** Returns cosine similarity in [−1, 1]. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Cosine distance: 1 − cosine_similarity. */
function cosineDistance(a: Float32Array, b: Float32Array): number {
    return 1 - cosineSimilarity(a, b);
}

/** Compute mean of an array of Float32Arrays (centroid). */
function computeCentroid(vecs: Float32Array[]): Float32Array {
    const dims = vecs[0].length;
    const centroid = new Float32Array(dims);
    for (const v of vecs) {
        for (let i = 0; i < dims; i++) centroid[i] += v[i];
    }
    const n = vecs.length;
    for (let i = 0; i < dims; i++) centroid[i] /= n;
    return centroid;
}

/** Maximum element-wise delta between two centroids. */
function centroidDelta(a: Float32Array, b: Float32Array): number {
    let max = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > max) max = d;
    }
    return max;
}

// ── k-means++ initialization ──────────────────────────────────────────────────

function kmeanspp(points: Float32Array[], k: number, rng: () => number): Float32Array[] {
    const centroids: Float32Array[] = [];

    // Pick first centroid uniformly at random
    centroids.push(points[Math.floor(rng() * points.length)]);

    // Pick remaining centroids with probability proportional to squared distance
    for (let c = 1; c < k; c++) {
        const distances = points.map((p) => {
            const minDist = Math.min(...centroids.map((cent) => cosineDistance(p, cent)));
            return minDist * minDist;
        });
        const total = distances.reduce((s, d) => s + d, 0);

        // Weighted random selection
        let r = rng() * total;
        let idx = 0;
        for (let i = 0; i < distances.length; i++) {
            r -= distances[i];
            if (r <= 0) { idx = i; break; }
        }
        centroids.push(points[idx]);
    }

    return centroids;
}

// ── Main k-means ──────────────────────────────────────────────────────────────

/**
 * Cluster file embeddings using k-means.
 *
 * @param embeddings  Map from file ID to embedding vector
 * @param k           Optional override for k (default: ceil(sqrt(n/2)), min 3, max 30)
 * @returns           Map from cluster index to array of file IDs
 */
export function clusterEmbeddings(
    embeddings: Map<string, Float32Array>,
    k?: number
): Map<number, string[]> {
    if (embeddings.size === 0) return new Map();

    // Sort by file path for deterministic ordering
    const sorted = [...embeddings.entries()].sort(([a], [b]) => a.localeCompare(b));
    const ids = sorted.map(([id]) => id);
    const vectors = sorted.map(([, v]) => v);
    const n = vectors.length;

    // Compute k
    const effectiveK = k ?? Math.min(30, Math.max(3, Math.ceil(Math.sqrt(n / 2))));

    // If we have fewer points than k, each point is its own cluster
    if (n <= effectiveK) {
        const clusters = new Map<number, string[]>();
        for (let i = 0; i < n; i++) clusters.set(i, [ids[i]]);
        return clusters;
    }

    // Seed from sorted file IDs for reproducibility
    const seed = hashSeed(ids);
    const rng = makeRNG(seed);

    // k-means++ initialization
    let centroids = kmeanspp(vectors, effectiveK, rng);
    let assignments = new Array<number>(n).fill(0);

    // Iterate
    for (let iter = 0; iter < 50; iter++) {
        // Assignment step
        for (let i = 0; i < n; i++) {
            let bestCluster = 0;
            let bestDist = Infinity;
            for (let c = 0; c < effectiveK; c++) {
                const d = cosineDistance(vectors[i], centroids[c]);
                if (d < bestDist) { bestDist = d; bestCluster = c; }
            }
            assignments[i] = bestCluster;
        }

        // Update step: recompute centroids
        const newCentroids: Float32Array[] = [];
        let converged = true;

        for (let c = 0; c < effectiveK; c++) {
            const clusterVecs = vectors.filter((_, i) => assignments[i] === c);
            const newCentroid = clusterVecs.length > 0
                ? computeCentroid(clusterVecs)
                : centroids[c]; // keep old centroid if cluster is empty

            if (centroidDelta(centroids[c], newCentroid) > 1e-6) converged = false;
            newCentroids.push(newCentroid);
        }

        centroids = newCentroids;
        if (converged) break;
    }

    // Build result map, sorted file IDs within each cluster
    const result = new Map<number, string[]>();
    for (let c = 0; c < effectiveK; c++) {
        const clusterIds = ids
            .filter((_, i) => assignments[i] === c)
            .sort();
        if (clusterIds.length > 0) result.set(c, clusterIds);
    }

    return result;
}
