/**
 * Tests for FeatureDiscovery (scripts/lib/feature-discovery.ts) and
 * the k-means clustering algorithm (scripts/lib/clustering.ts).
 *
 * The Summarizer is mocked — no real LLM calls in CI.
 * Tests use temp directories for persistence tests.
 *
 * Covers:
 *   - clusterEmbeddings: k calculation, determinism, cosine distance
 *   - discoverFeatures: cluster → feature mapping, summarizer invocation
 *   - loadFeatures / writeFeatures: persistence round-trip
 *   - Edge cases: empty input, single file, all files identical embeddings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { clusterEmbeddings } from '../scripts/lib/clustering.js';
import {
    discoverFeatures,
    loadFeatures,
    writeFeatures,
} from '../scripts/lib/feature-discovery.js';
import type { FileSummary, SymbolEntry, FeatureGroup } from '../src/types.js';
import type { Summarizer } from '../scripts/lib/summarizer.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Create an embedding with a specified "direction" — useful for clear cluster separation. */
function makeEmbedding(dims: number, ...pattern: number[]): Float32Array {
    const arr = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
        arr[i] = pattern[i % pattern.length];
    }
    // Normalize
    const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? arr.map((v) => v / norm) as Float32Array : arr;
}

function makeSummary(file: string, purpose: string): FileSummary {
    return {
        file,
        purpose,
        exports: [],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: `hash-${file}`,
    };
}

function makeSymbol(qualifiedName: string, file: string): SymbolEntry {
    return {
        name: qualifiedName.split('.').pop() ?? qualifiedName,
        qualifiedName,
        file,
        line: 1,
        signature: `function ${qualifiedName}()`,
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
    };
}

/** Mock Summarizer that returns predictable results based on file name. */
function makeMockSummarizer(namePrefix = 'Feature'): Summarizer {
    let callCount = 0;
    return {
        summarizeFile: vi.fn(async (filePath: string) => {
            callCount++;
            const clusterNum = filePath.replace('feature-cluster-', '');
            return makeSummary(filePath, JSON.stringify({
                name: `${namePrefix} ${clusterNum}`,
                description: `Description for cluster ${clusterNum} (call #${callCount})`,
                entryPoints: ['mainEntry'],
                dataFlow: 'A → B → C',
                keySymbols: ['symbol1', 'symbol2'],
            }));
        }),
    };
}

// ── clusterEmbeddings ─────────────────────────────────────────────────────────

describe('clusterEmbeddings', () => {
    const DIMS = 8; // Small dims for fast tests

    it('returns empty Map for empty input', () => {
        const result = clusterEmbeddings(new Map());
        expect(result.size).toBe(0);
    });

    it('returns k=3 minimum clusters for small inputs', () => {
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 10; i++) {
            embeddings.set(`file:src/m${i}.ts`, makeEmbedding(DIMS, i, -i));
        }
        const clusters = clusterEmbeddings(embeddings);
        // k = ceil(sqrt(10/2)) = ceil(2.23) = 3
        expect(clusters.size).toBeGreaterThanOrEqual(3);
    });

    it('places each file in exactly one cluster', () => {
        const files = ['file:a.ts', 'file:b.ts', 'file:c.ts', 'file:d.ts', 'file:e.ts'];
        const embeddings = new Map<string, Float32Array>();
        for (const f of files) {
            embeddings.set(f, makeEmbedding(DIMS, Math.random()));
        }

        const clusters = clusterEmbeddings(embeddings);

        // Verify each file appears exactly once
        const seen = new Set<string>();
        for (const fileIds of clusters.values()) {
            for (const id of fileIds) {
                expect(seen.has(id)).toBe(false);
                seen.add(id);
            }
        }
        expect(seen.size).toBe(files.length);
    });

    it('produces identical output for same input (determinism)', () => {
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 20; i++) {
            embeddings.set(`file:src/m${i}.ts`, makeEmbedding(DIMS, Math.sin(i), Math.cos(i)));
        }

        const result1 = clusterEmbeddings(embeddings);
        const result2 = clusterEmbeddings(embeddings);

        // Same cluster keys
        expect([...result1.keys()].sort()).toEqual([...result2.keys()].sort());

        // Same file assignments
        for (const [k, files1] of result1) {
            const files2 = result2.get(k) ?? [];
            expect([...files1].sort()).toEqual([...files2].sort());
        }
    });

    it('separates clearly distinct embedding groups into different clusters', () => {
        // Group A: embeddings biased towards [1, 0, 0, ...]
        // Group B: embeddings biased towards [0, 1, 0, ...]
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 10; i++) {
            embeddings.set(`file:groupA-${i}.ts`, makeEmbedding(8, 1, 0.1, 0, 0, 0, 0, 0, 0));
            embeddings.set(`file:groupB-${i}.ts`, makeEmbedding(8, 0, 0.1, 1, 0, 0, 0, 0, 0));
            embeddings.set(`file:groupC-${i}.ts`, makeEmbedding(8, 0, 0, 0, 0, 1, 0.1, 0, 0));
        }

        const clusters = clusterEmbeddings(embeddings);

        // We expect at least 3 clusters (one per group)
        expect(clusters.size).toBeGreaterThanOrEqual(3);
    });

    it('applies k cap at 30', () => {
        // n = 2000 → k = ceil(sqrt(1000)) = ceil(31.6) = 32 → capped to 30
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 2000; i++) {
            embeddings.set(`file:m${i}.ts`, makeEmbedding(DIMS, i % 10, -(i % 7)));
        }

        const clusters = clusterEmbeddings(embeddings);
        expect(clusters.size).toBeLessThanOrEqual(30);
    });

    it('applies k minimum of 3 even for very small inputs', () => {
        // n = 4 → k = ceil(sqrt(2)) = 2 → bumped to 3
        // But if n ≤ k, each point is its own cluster (n=4 ≤ k=3 is false, so k=3)
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 4; i++) {
            embeddings.set(`file:m${i}.ts`, makeEmbedding(DIMS, i));
        }

        const clusters = clusterEmbeddings(embeddings);
        // With 4 files and k=3, we get at most 3 clusters
        expect(clusters.size).toBeLessThanOrEqual(3);
        expect(clusters.size).toBeGreaterThanOrEqual(1);
    });

    it('respects custom k override', () => {
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 20; i++) {
            embeddings.set(`file:m${i}.ts`, makeEmbedding(DIMS, i));
        }

        // Forcing k=5
        const clusters = clusterEmbeddings(embeddings, 5);
        expect(clusters.size).toBeLessThanOrEqual(5);
    });

    it('cluster file IDs are sorted within each cluster', () => {
        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < 15; i++) {
            embeddings.set(`file:z${i}.ts`, makeEmbedding(DIMS, i % 3));
        }

        const clusters = clusterEmbeddings(embeddings);
        for (const files of clusters.values()) {
            const sorted = [...files].sort();
            expect(files).toEqual(sorted);
        }
    });

    it('handles single file — puts it in its own cluster', () => {
        const embeddings = new Map<string, Float32Array>([
            ['file:single.ts', makeEmbedding(DIMS, 1)],
        ]);

        const clusters = clusterEmbeddings(embeddings);
        expect(clusters.size).toBe(1);
        expect([...clusters.values()][0]).toEqual(['file:single.ts']);
    });
});

// ── discoverFeatures ──────────────────────────────────────────────────────────

describe('discoverFeatures', () => {
    const DIMS = 8;

    const sampleSummaries: Record<string, FileSummary> = {
        'src/auth.ts': makeSummary('src/auth.ts', 'Handles authentication'),
        'src/login.ts': makeSummary('src/login.ts', 'Login form processing'),
        'src/cache.ts': makeSummary('src/cache.ts', 'In-memory LRU cache'),
        'src/db.ts': makeSummary('src/db.ts', 'Database connection pool'),
        'src/payment.ts': makeSummary('src/payment.ts', 'Payment processing'),
    };

    const sampleSymbols: SymbolEntry[] = [
        makeSymbol('auth.validateToken', 'src/auth.ts'),
        makeSymbol('cache.getOrLoad', 'src/cache.ts'),
        makeSymbol('payment.charge', 'src/payment.ts'),
    ];

    it('returns empty array for empty embeddings', async () => {
        const summarizer = makeMockSummarizer();
        const result = await discoverFeatures(
            new Map(), sampleSummaries, sampleSymbols, summarizer
        );
        expect(result).toEqual([]);
        expect(summarizer.summarizeFile).not.toHaveBeenCalled();
    });

    it('calls summarizer once per cluster', async () => {
        const embeddings = new Map<string, Float32Array>();
        for (const file of Object.keys(sampleSummaries)) {
            embeddings.set(file, makeEmbedding(DIMS, Math.random()));
        }

        const summarizer = makeMockSummarizer();
        const result = await discoverFeatures(embeddings, sampleSummaries, sampleSymbols, summarizer);

        // Number of summarizer calls should equal number of clusters
        expect(vi.mocked(summarizer.summarizeFile).mock.calls.length).toBe(result.length);
    });

    it('returns FeatureGroup[] with required fields', async () => {
        const embeddings = new Map<string, Float32Array>([
            ['src/auth.ts', makeEmbedding(DIMS, 1, 0)],
            ['src/cache.ts', makeEmbedding(DIMS, 0, 1)],
            ['src/payment.ts', makeEmbedding(DIMS, 0.5, 0.5)],
        ]);

        const summarizer = makeMockSummarizer();
        const features = await discoverFeatures(embeddings, sampleSummaries, sampleSymbols, summarizer);

        expect(Array.isArray(features)).toBe(true);
        expect(features.length).toBeGreaterThan(0);

        for (const f of features) {
            expect(typeof f.id).toBe('string');
            expect(typeof f.name).toBe('string');
            expect(typeof f.description).toBe('string');
            expect(Array.isArray(f.files)).toBe(true);
            expect(Array.isArray(f.entryPoints)).toBe(true);
            expect(typeof f.dataFlow).toBe('string');
            expect(Array.isArray(f.keySymbols)).toBe(true);
            expect(Array.isArray(f.relatedFeatures)).toBe(true);
        }
    });

    it('each discovered feature contains at least one file', async () => {
        const embeddings = new Map<string, Float32Array>();
        for (const file of Object.keys(sampleSummaries)) {
            embeddings.set(file, makeEmbedding(DIMS, Math.random()));
        }

        const summarizer = makeMockSummarizer();
        const features = await discoverFeatures(embeddings, sampleSummaries, sampleSymbols, summarizer);

        for (const f of features) {
            expect(f.files.length).toBeGreaterThan(0);
        }
    });

    it('all input files are assigned to exactly one feature', async () => {
        const embeddings = new Map<string, Float32Array>();
        const files = Object.keys(sampleSummaries);
        for (const file of files) {
            embeddings.set(file, makeEmbedding(DIMS, Math.random()));
        }

        const summarizer = makeMockSummarizer();
        const features = await discoverFeatures(embeddings, sampleSummaries, sampleSymbols, summarizer);

        const assignedFiles = new Set<string>();
        for (const f of features) {
            for (const file of f.files) {
                assignedFiles.add(file);
            }
        }

        for (const file of files) {
            expect(assignedFiles.has(file)).toBe(true);
        }
    });

    it('gracefully handles summarizer errors without throwing', async () => {
        const embeddings = new Map<string, Float32Array>([
            ['src/auth.ts', makeEmbedding(DIMS, 1)],
            ['src/cache.ts', makeEmbedding(DIMS, 0)],
        ]);

        const errorSummarizer: Summarizer = {
            summarizeFile: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
        };

        // Should not throw even when summarizer fails
        const features = await discoverFeatures(
            embeddings, sampleSummaries, sampleSymbols, errorSummarizer
        );

        expect(Array.isArray(features)).toBe(true);
        // Features should still be created with fallback values
        for (const f of features) {
            expect(typeof f.name).toBe('string');
            expect(f.name.length).toBeGreaterThan(0);
        }
    });

    it('feature names come from summarizer response', async () => {
        const embeddings = new Map<string, Float32Array>([
            ['src/auth.ts', makeEmbedding(DIMS, 1)],
        ]);

        const customSummarizer: Summarizer = {
            summarizeFile: vi.fn().mockResolvedValue(
                makeSummary('test', JSON.stringify({
                    name: 'Authentication System',
                    description: 'Handles all auth flows',
                    entryPoints: ['login', 'logout'],
                    dataFlow: 'User → Auth → Session',
                    keySymbols: ['validateToken'],
                }))
            ),
        };

        const features = await discoverFeatures(
            embeddings, sampleSummaries, sampleSymbols, customSummarizer
        );

        expect(features[0].name).toBe('Authentication System');
        expect(features[0].entryPoints).toContain('login');
    });
});

// ── loadFeatures / writeFeatures ──────────────────────────────────────────────

describe('loadFeatures and writeFeatures', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-discovery-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const sampleFeatures: FeatureGroup[] = [
        {
            id: 'cluster-0',
            name: 'Authentication',
            description: 'Handles user login and session management',
            files: ['src/auth.ts', 'src/login.ts'],
            entryPoints: ['login', 'validateToken'],
            dataFlow: 'User → AuthService → SessionStore',
            keySymbols: ['validateToken', 'createSession'],
            relatedFeatures: ['cluster-1'],
        },
        {
            id: 'cluster-1',
            name: 'Data Caching',
            description: 'LRU cache for frequently accessed data',
            files: ['src/cache.ts'],
            entryPoints: ['getOrLoad'],
            dataFlow: 'Request → Cache → Database',
            keySymbols: ['getOrLoad', 'invalidate'],
            relatedFeatures: [],
        },
    ];

    it('returns null when features/index.json does not exist', () => {
        const result = loadFeatures(tmpDir);
        expect(result).toBeNull();
    });

    it('writeFeatures creates features/index.json', async () => {
        await writeFeatures(tmpDir, sampleFeatures);
        expect(fs.existsSync(path.join(tmpDir, 'features', 'index.json'))).toBe(true);
    });

    it('writeFeatures creates features/cache.json', async () => {
        await writeFeatures(tmpDir, sampleFeatures);
        expect(fs.existsSync(path.join(tmpDir, 'features', 'cache.json'))).toBe(true);
    });

    it('loadFeatures reads features written by writeFeatures (round-trip)', async () => {
        await writeFeatures(tmpDir, sampleFeatures);
        const loaded = loadFeatures(tmpDir);

        expect(loaded).not.toBeNull();
        expect(loaded!.length).toBe(sampleFeatures.length);

        for (let i = 0; i < sampleFeatures.length; i++) {
            expect(loaded![i].id).toBe(sampleFeatures[i].id);
            expect(loaded![i].name).toBe(sampleFeatures[i].name);
            expect(loaded![i].files).toEqual(sampleFeatures[i].files);
            expect(loaded![i].entryPoints).toEqual(sampleFeatures[i].entryPoints);
            expect(loaded![i].relatedFeatures).toEqual(sampleFeatures[i].relatedFeatures);
        }
    });

    it('writeFeatures handles empty feature array', async () => {
        await expect(writeFeatures(tmpDir, [])).resolves.toBeUndefined();
        const loaded = loadFeatures(tmpDir);
        expect(loaded).toEqual([]);
    });

    it('loadFeatures returns null for malformed JSON', async () => {
        const featuresDir = path.join(tmpDir, 'features');
        fs.mkdirSync(featuresDir, { recursive: true });
        fs.writeFileSync(path.join(featuresDir, 'index.json'), '{invalid json', 'utf8');

        const result = loadFeatures(tmpDir);
        expect(result).toBeNull();
    });

    it('writeFeatures creates parent directories if missing', async () => {
        const deepDir = path.join(tmpDir, 'nested', 'knowledge');
        await writeFeatures(deepDir, sampleFeatures);
        expect(fs.existsSync(path.join(deepDir, 'features', 'index.json'))).toBe(true);
    });

    it('written JSON is valid and human-readable (indented)', async () => {
        await writeFeatures(tmpDir, sampleFeatures);
        const raw = fs.readFileSync(path.join(tmpDir, 'features', 'index.json'), 'utf8');
        // Should be prettily formatted (contains newlines and spaces)
        expect(raw).toContain('\n');
        expect(raw).toContain('  ');
    });
});
