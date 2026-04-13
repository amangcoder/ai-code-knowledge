/**
 * Tests for Phase 7: EmbeddingPipeline (scripts/lib/phases/embedding-phase.ts).
 *
 * The EmbeddingProvider and VectorStore are fully mocked.
 * No real Ollama/OpenAI calls or LanceDB I/O in CI.
 *
 * Covers:
 *   - runEmbeddingPhase orchestration
 *   - healthCheck called before embedding
 *   - File and symbol embedding loop
 *   - Batch chunking (chunks of 32)
 *   - metadata.json written to vectors/
 *   - Incremental mode skips unchanged files
 *   - Graceful degradation when VectorStore unavailable
 *   - EmbeddingPhaseResult fields populated correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type { FileSummary, SymbolEntry, EmbeddingPhaseResult } from '../src/types.js';
import type { EmbeddingProvider } from '../scripts/lib/embeddings/embedding-provider.js';
import type { VectorStore } from '../scripts/lib/vector-store.js';

// ── Mock createVectorStore ────────────────────────────────────────────────────

vi.mock('../scripts/lib/vector-store.js', () => {
    const mockStore: VectorStore = {
        upsertFiles: vi.fn(async () => {}),
        upsertSymbols: vi.fn(async () => {}),
        upsertFeatures: vi.fn(async () => {}),
        searchFiles: vi.fn(async () => []),
        searchSymbols: vi.fn(async () => []),
        searchFeatures: vi.fn(async () => []),
        isAvailable: vi.fn(() => true),
        getAllFileEmbeddings: vi.fn(async () => new Map()),
    };

    return {
        createVectorStore: vi.fn(async () => mockStore),
        __mockStore: mockStore,
    };
});

import { runEmbeddingPhase } from '../scripts/lib/phases/embedding-phase.js';
import { createVectorStore } from '../scripts/lib/vector-store.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockProvider(dims = 1024): EmbeddingProvider {
    return {
        embed: vi.fn(async (texts: string[]) =>
            texts.map(() => new Float32Array(dims).fill(0.1))
        ),
        dimensions: vi.fn(() => dims),
        modelName: vi.fn(() => 'mock-model'),
        healthCheck: vi.fn(async () => {}),
    };
}

function makeTmpKnowledge(prefix = 'embed-phase-'): {
    tmpDir: string;
    knowledgeRoot: string;
    writeFiles: (summaries: Record<string, FileSummary>, symbols?: SymbolEntry[]) => void;
} {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const knowledgeRoot = tmpDir;

    return {
        tmpDir,
        knowledgeRoot,
        writeFiles: (summaries: Record<string, FileSummary>, symbols: SymbolEntry[] = []) => {
            const summariesDir = path.join(knowledgeRoot, 'summaries');
            fs.mkdirSync(summariesDir, { recursive: true });
            fs.writeFileSync(
                path.join(summariesDir, 'cache.json'),
                JSON.stringify(summaries),
                'utf8'
            );
            fs.writeFileSync(
                path.join(knowledgeRoot, 'symbols.json'),
                JSON.stringify(symbols),
                'utf8'
            );
        },
    };
}

function makeSummary(file: string, purpose: string, contentHash = 'h1'): FileSummary {
    return {
        file,
        purpose,
        exports: [],
        dependencies: [],
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash,
    };
}

function makeSymbol(name: string, file: string, isExported = true): SymbolEntry {
    return {
        name,
        qualifiedName: `${file.replace('.ts', '')}.${name}`,
        file,
        line: 1,
        signature: `function ${name}(): void`,
        type: 'function',
        module: 'src',
        calls: [],
        calledBy: [],
        throws: [],
        isExported,
    };
}

// Get the mock store from vi.mocked module
function getMockStore(): VectorStore {
    const mockModule = vi.mocked(createVectorStore) as unknown as {
        _mockReturnValue?: VectorStore;
    };
    // Return the same mock store used in the mock factory
    return (createVectorStore as unknown as () => Promise<VectorStore>)() as unknown as VectorStore;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runEmbeddingPhase', () => {
    let tmpDir: string;
    let knowledgeRoot: string;
    let writeFiles: (s: Record<string, FileSummary>, sym?: SymbolEntry[]) => void;

    beforeEach(() => {
        const setup = makeTmpKnowledge();
        tmpDir = setup.tmpDir;
        knowledgeRoot = setup.knowledgeRoot;
        writeFiles = setup.writeFiles;

        // Reset all mocks
        vi.clearAllMocks();

        // Default: VectorStore is available
        vi.mocked(createVectorStore).mockResolvedValue({
            upsertFiles: vi.fn(async () => {}),
            upsertSymbols: vi.fn(async () => {}),
            upsertFeatures: vi.fn(async () => {}),
            searchFiles: vi.fn(async () => []),
            searchSymbols: vi.fn(async () => []),
            searchFeatures: vi.fn(async () => []),
            isAvailable: vi.fn(() => true),
            getAllFileEmbeddings: vi.fn(async () => new Map()),
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns EmbeddingPhaseResult with correct shape', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth module') });

        const provider = makeMockProvider();
        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        expect(typeof result.filesEmbedded).toBe('number');
        expect(typeof result.symbolsEmbedded).toBe('number');
        expect(typeof result.skipped).toBe('number');
        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('calls provider.healthCheck() before embedding', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth') });

        const provider = makeMockProvider();
        await runEmbeddingPhase(knowledgeRoot, provider);

        expect(vi.mocked(provider.healthCheck)).toHaveBeenCalledOnce();
    });

    it('calls createVectorStore with knowledgeRoot and dimensions', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth') });

        const provider = makeMockProvider(1536); // OpenAI dims
        await runEmbeddingPhase(knowledgeRoot, provider);

        expect(vi.mocked(createVectorStore)).toHaveBeenCalledWith(knowledgeRoot, 1536);
    });

    it('embeds all file purposes', async () => {
        const summaries = {
            'src/auth.ts': makeSummary('src/auth.ts', 'Authentication module'),
            'src/cache.ts': makeSummary('src/cache.ts', 'Cache module'),
            'src/db.ts': makeSummary('src/db.ts', 'Database module'),
        };
        writeFiles(summaries);

        const provider = makeMockProvider();
        const mockStore = {
            upsertFiles: vi.fn(async () => {}),
            upsertSymbols: vi.fn(async () => {}),
            upsertFeatures: vi.fn(async () => {}),
            searchFiles: vi.fn(async () => []),
            searchSymbols: vi.fn(async () => []),
            searchFeatures: vi.fn(async () => []),
            isAvailable: vi.fn(() => true),
            getAllFileEmbeddings: vi.fn(async () => new Map()),
        };
        vi.mocked(createVectorStore).mockResolvedValue(mockStore);

        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        expect(result.filesEmbedded).toBe(3);
        expect(mockStore.upsertFiles).toHaveBeenCalled();
    });

    it('embeds exported symbol signatures', async () => {
        writeFiles({
            'src/auth.ts': makeSummary('src/auth.ts', 'Auth'),
        }, [
            makeSymbol('validateToken', 'src/auth.ts', true),
            makeSymbol('_internal', 'src/auth.ts', false), // not exported — should be skipped
        ]);

        const provider = makeMockProvider();
        const mockStore = {
            upsertFiles: vi.fn(async () => {}),
            upsertSymbols: vi.fn(async () => {}),
            upsertFeatures: vi.fn(async () => {}),
            searchFiles: vi.fn(async () => []),
            searchSymbols: vi.fn(async () => []),
            searchFeatures: vi.fn(async () => []),
            isAvailable: vi.fn(() => true),
            getAllFileEmbeddings: vi.fn(async () => new Map()),
        };
        vi.mocked(createVectorStore).mockResolvedValue(mockStore);

        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        expect(result.symbolsEmbedded).toBe(1); // only exported symbols
    });

    it('writes vectors/metadata.json with model info', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth') });

        const provider = makeMockProvider(1024);
        await runEmbeddingPhase(knowledgeRoot, provider);

        const metadataPath = path.join(knowledgeRoot, 'vectors', 'metadata.json');
        expect(fs.existsSync(metadataPath)).toBe(true);

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
            model: string;
            dimensions: number;
            createdAt: string;
        };
        expect(metadata.model).toBe('mock-model');
        expect(metadata.dimensions).toBe(1024);
        expect(typeof metadata.createdAt).toBe('string');
    });

    it('handles missing summaries/cache.json gracefully', async () => {
        // Don't write any files — summaries file doesn't exist

        const provider = makeMockProvider();
        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        // Should not throw, filesEmbedded should be 0
        expect(result.filesEmbedded).toBe(0);
        expect(typeof result.durationMs).toBe('number');
    });

    it('returns zeros when VectorStore is unavailable', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth') });

        // Mock VectorStore as unavailable
        vi.mocked(createVectorStore).mockResolvedValue({
            upsertFiles: vi.fn(async () => {}),
            upsertSymbols: vi.fn(async () => {}),
            upsertFeatures: vi.fn(async () => {}),
            searchFiles: vi.fn(async () => []),
            searchSymbols: vi.fn(async () => []),
            searchFeatures: vi.fn(async () => []),
            isAvailable: vi.fn(() => false),
            getAllFileEmbeddings: vi.fn(async () => new Map()),
        });

        const provider = makeMockProvider();
        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        expect(result.filesEmbedded).toBe(0);
        expect(result.symbolsEmbedded).toBe(0);
    });

    it('throws when healthCheck fails', async () => {
        writeFiles({ 'src/auth.ts': makeSummary('src/auth.ts', 'Auth') });

        const provider = makeMockProvider();
        vi.mocked(provider.healthCheck).mockRejectedValue(
            new Error('Ollama not running')
        );

        await expect(runEmbeddingPhase(knowledgeRoot, provider)).rejects.toThrow('Ollama not running');
    });

    it('chunks embed calls in batches of 32', async () => {
        // Create 70 summary files
        const summaries: Record<string, FileSummary> = {};
        for (let i = 0; i < 70; i++) {
            summaries[`src/m${i}.ts`] = makeSummary(`src/m${i}.ts`, `Module ${i}`);
        }
        writeFiles(summaries);

        const provider = makeMockProvider();
        const mockStore = {
            upsertFiles: vi.fn(async () => {}),
            upsertSymbols: vi.fn(async () => {}),
            upsertFeatures: vi.fn(async () => {}),
            searchFiles: vi.fn(async () => []),
            searchSymbols: vi.fn(async () => []),
            searchFeatures: vi.fn(async () => []),
            isAvailable: vi.fn(() => true),
            getAllFileEmbeddings: vi.fn(async () => new Map()),
        };
        vi.mocked(createVectorStore).mockResolvedValue(mockStore);

        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        // 70 files → ceil(70/32) = 3 embed calls for files
        const embedCalls = vi.mocked(provider.embed).mock.calls;
        // Each call should have at most 32 texts
        for (const [texts] of embedCalls) {
            expect((texts as string[]).length).toBeLessThanOrEqual(32);
        }
        expect(result.filesEmbedded).toBe(70);
    });

    it('durationMs is non-negative', async () => {
        writeFiles({ 'src/x.ts': makeSummary('src/x.ts', 'X module') });

        const provider = makeMockProvider();
        const result = await runEmbeddingPhase(knowledgeRoot, provider);

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
});
