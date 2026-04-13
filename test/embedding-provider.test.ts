/**
 * Tests for the scripts-side EmbeddingProvider implementations.
 *
 * All HTTP calls to HuggingFace/Ollama/OpenAI are mocked using vi.spyOn(global, 'fetch').
 * No real external service calls are made in CI.
 *
 * Covers:
 *   - Factory selection (EMBEDDING_MODEL env var)
 *   - HuggingFaceEmbeddingProvider: embed, batch, auth, error handling
 *   - OllamaEmbeddingProvider: embed, healthCheck, error handling
 *   - OpenAIEmbeddingProvider: embed, batch ordering, error handling
 *   - Batch chunking (chunks of 32)
 *   - Semaphore concurrency limiting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HuggingFaceEmbeddingProvider } from '../scripts/lib/embeddings/huggingface-embedding-provider.js';
import { OllamaEmbeddingProvider } from '../scripts/lib/embeddings/ollama-embedding-provider.js';
import { OpenAIEmbeddingProvider } from '../scripts/lib/embeddings/openai-embedding-provider.js';
import { createEmbeddingProvider } from '../scripts/lib/embeddings/embedding-factory.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock fetch response. */
function mockResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

/** Create a Float32Array with a predictable pattern for a given index. */
function mockEmbedding(index: number, dims = 768): number[] {
    return Array.from({ length: dims }, (_, i) => (index + i) / (dims + index + 1));
}

// ── HuggingFaceEmbeddingProvider ──────────────────────────────────────────────

describe('HuggingFaceEmbeddingProvider', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('returns Float32Array[] from embed()', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider();
        const result = await provider.embed(['hello world']);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Float32Array);
        expect(result[0].length).toBe(1024);
    });

    it('sends request to correct HuggingFace endpoint with model in URL', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0)])
        );

        const provider = new HuggingFaceEmbeddingProvider('Salesforce/codesage-large');
        await provider.embed(['text']);

        const url = fetchSpy.mock.calls[0][0] as string;
        expect(url).toBe(
            'https://api-inference.huggingface.co/pipeline/feature-extraction/Salesforce/codesage-large'
        );
    });

    it('sends batch inputs in a single API call', async () => {
        const texts = ['text 1', 'text 2', 'text 3'];
        fetchSpy.mockResolvedValue(
            mockResponse(texts.map((_, i) => mockEmbedding(i, 1024)))
        );

        const provider = new HuggingFaceEmbeddingProvider();
        const result = await provider.embed(texts);

        expect(result).toHaveLength(3);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as { inputs: string[] };
        expect(body.inputs).toEqual(texts);
    });

    it('includes Authorization header when token provided', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider(
            'Salesforce/codesage-large',
            'hf_test_token_123'
        );
        await provider.embed(['test']);

        const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer hf_test_token_123');
    });

    it('omits Authorization header when no token provided', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider();
        await provider.embed(['test']);

        const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
        expect(headers['Authorization']).toBeUndefined();
    });

    it('sends wait_for_model option in request body', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider();
        await provider.embed(['test']);

        const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
            options: { wait_for_model: boolean };
        };
        expect(body.options.wait_for_model).toBe(true);
    });

    it('does NOT prepend any task-type prefix', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider();
        await provider.embed(['test text']);

        const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as { inputs: string[] };
        expect(body.inputs).toEqual(['test text']);
    });

    it('throws on HTTP error response', async () => {
        fetchSpy.mockResolvedValue(mockResponse('Model not found', 404));

        const provider = new HuggingFaceEmbeddingProvider();
        await expect(provider.embed(['test'])).rejects.toThrow(/HuggingFace embed failed.*404/);
    });

    it('chunks texts in batches of 32', async () => {
        fetchSpy.mockImplementation(async (_, init) => {
            const body = JSON.parse((init as RequestInit).body as string) as { inputs: string[] };
            return mockResponse(body.inputs.map((_, i) => mockEmbedding(i)));
        });

        const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`);
        const provider = new HuggingFaceEmbeddingProvider();
        const result = await provider.embed(texts);

        expect(result).toHaveLength(70);
        expect(fetchSpy).toHaveBeenCalledTimes(3); // 32 + 32 + 6
    });

    it('dimensions() returns 1024 by default', () => {
        const provider = new HuggingFaceEmbeddingProvider();
        expect(provider.dimensions()).toBe(1024);
    });

    it('dimensions() returns custom value when configured', () => {
        const provider = new HuggingFaceEmbeddingProvider('Salesforce/codesage-large', undefined, 1024);
        expect(provider.dimensions()).toBe(1024);
    });

    it('modelName() returns configured model', () => {
        const provider = new HuggingFaceEmbeddingProvider('Salesforce/codesage-large');
        expect(provider.modelName()).toBe('Salesforce/codesage-large');
    });

    it('modelName() returns default model', () => {
        const provider = new HuggingFaceEmbeddingProvider();
        expect(provider.modelName()).toBe('Salesforce/codesage-large');
    });

    it('healthCheck() calls embed() with a short ping string', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse([mockEmbedding(0, 1024)])
        );

        const provider = new HuggingFaceEmbeddingProvider();
        await expect(provider.healthCheck()).resolves.toBeUndefined();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// ── OllamaEmbeddingProvider ───────────────────────────────────────────────────

describe('OllamaEmbeddingProvider', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('returns Float32Array[] from embed()', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434');
        const result = await provider.embed(['hello world']);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Float32Array);
        expect(result[0].length).toBe(768);
    });

    it('prepends "search_document:" prefix in request body', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const provider = new OllamaEmbeddingProvider();
        await provider.embed(['test text']);

        const call = fetchSpy.mock.calls[0];
        const body = JSON.parse(call[1]?.body as string) as { prompt: string };
        expect(body.prompt).toBe('search_document: test text');
    });

    it('sends request to correct Ollama endpoint', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434');
        await provider.embed(['text']);

        const url = fetchSpy.mock.calls[0][0] as string;
        expect(url).toBe('http://localhost:11434/api/embeddings');
    });

    it('embeds multiple texts making separate HTTP calls', async () => {
        fetchSpy.mockImplementation(async () =>
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const provider = new OllamaEmbeddingProvider();
        const result = await provider.embed(['text 1', 'text 2', 'text 3']);

        expect(result).toHaveLength(3);
        // Ollama provider makes one call per text
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('chunks texts in batches of 32', async () => {
        fetchSpy.mockImplementation(async () =>
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`);
        const provider = new OllamaEmbeddingProvider();
        const result = await provider.embed(texts);

        expect(result).toHaveLength(70);
        expect(fetchSpy).toHaveBeenCalledTimes(70); // one call per text
    });

    it('throws on HTTP error response', async () => {
        fetchSpy.mockResolvedValue(mockResponse({}, 503));

        const provider = new OllamaEmbeddingProvider();
        await expect(provider.embed(['test'])).rejects.toThrow(/Ollama embed failed.*503/);
    });

    it('healthCheck() calls /api/tags endpoint', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ models: [{ name: 'nomic-embed-text' }] })
        );

        const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434');
        await expect(provider.healthCheck()).resolves.toBeUndefined();

        const url = fetchSpy.mock.calls[0][0] as string;
        expect(url).toBe('http://localhost:11434/api/tags');
    });

    it('healthCheck() throws when model not found', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ models: [{ name: 'llama2' }] })
        );

        const provider = new OllamaEmbeddingProvider('nomic-embed-text');
        await expect(provider.healthCheck()).rejects.toThrow(/nomic-embed-text.*not found/i);
    });

    it('healthCheck() throws when Ollama not reachable', async () => {
        fetchSpy.mockResolvedValue(mockResponse({}, 503));

        const provider = new OllamaEmbeddingProvider();
        await expect(provider.healthCheck()).rejects.toThrow(/not reachable/i);
    });

    it('dimensions() returns 768 by default', () => {
        const provider = new OllamaEmbeddingProvider();
        expect(provider.dimensions()).toBe(768);
    });

    it('modelName() returns configured model', () => {
        const provider = new OllamaEmbeddingProvider('custom-model');
        expect(provider.modelName()).toBe('custom-model');
    });

    it('accepts custom baseUrl', async () => {
        fetchSpy.mockResolvedValue(
            mockResponse({ embedding: mockEmbedding(0) })
        );

        const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://my-server:9999');
        await provider.embed(['test']);

        const url = fetchSpy.mock.calls[0][0] as string;
        expect(url).toContain('http://my-server:9999');
    });

    it('returns correct embedding values from response', async () => {
        const expectedEmbedding = [1, 2, 3, 4]; // integers are exact in Float32
        fetchSpy.mockResolvedValue(mockResponse({ embedding: expectedEmbedding }));

        const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434', 4);
        const result = await provider.embed(['test']);

        expect(Array.from(result[0])).toEqual(expectedEmbedding);
    });
});

// ── OpenAIEmbeddingProvider ───────────────────────────────────────────────────

describe('OpenAIEmbeddingProvider', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    function makeOpenAIResponse(texts: string[]): Response {
        return mockResponse({
            data: texts.map((_, i) => ({
                embedding: mockEmbedding(i, 1536),
                index: i,
            })),
        });
    }

    it('throws when apiKey is empty', () => {
        expect(() => new OpenAIEmbeddingProvider('')).toThrow(/OPENAI_API_KEY/i);
    });

    it('returns Float32Array[] from embed()', async () => {
        fetchSpy.mockResolvedValue(makeOpenAIResponse(['hello']));

        const provider = new OpenAIEmbeddingProvider('test-key');
        const result = await provider.embed(['hello']);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Float32Array);
        expect(result[0].length).toBe(1536);
    });

    it('sends request to OpenAI embeddings endpoint', async () => {
        fetchSpy.mockResolvedValue(makeOpenAIResponse(['test']));

        const provider = new OpenAIEmbeddingProvider('my-api-key');
        await provider.embed(['test']);

        const url = fetchSpy.mock.calls[0][0] as string;
        expect(url).toBe('https://api.openai.com/v1/embeddings');
    });

    it('includes Authorization header with Bearer token', async () => {
        fetchSpy.mockResolvedValue(makeOpenAIResponse(['test']));

        const provider = new OpenAIEmbeddingProvider('sk-testkey123');
        await provider.embed(['test']);

        const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer sk-testkey123');
    });

    it('sends multiple texts in a single API call', async () => {
        const texts = ['text 1', 'text 2', 'text 3'];
        fetchSpy.mockResolvedValue(makeOpenAIResponse(texts));

        const provider = new OpenAIEmbeddingProvider('test-key');
        const result = await provider.embed(texts);

        expect(result).toHaveLength(3);
        expect(fetchSpy).toHaveBeenCalledTimes(1); // single batched call
        const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as { input: string[] };
        expect(body.input).toEqual(texts);
    });

    it('sorts results by index to maintain ordering', async () => {
        // Response with reversed index order
        fetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                data: [
                    { embedding: mockEmbedding(1, 1536), index: 1 },
                    { embedding: mockEmbedding(0, 1536), index: 0 },
                ],
            }),
        } as unknown as Response);

        const provider = new OpenAIEmbeddingProvider('test-key');
        const result = await provider.embed(['first', 'second']);

        // index 0 should be first regardless of response order
        expect(Array.from(result[0])[0]).toBeCloseTo(mockEmbedding(0, 1536)[0], 5);
    });

    it('chunks large batches (>100 texts) into multiple API calls', async () => {
        fetchSpy.mockImplementation(async (_, init) => {
            const body = JSON.parse((init as RequestInit).body as string) as { input: string[] };
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: body.input.map((_, i) => ({
                        embedding: mockEmbedding(i, 1536),
                        index: i,
                    })),
                }),
            } as unknown as Response;
        });

        const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
        const provider = new OpenAIEmbeddingProvider('test-key');
        const result = await provider.embed(texts);

        expect(result).toHaveLength(150);
        expect(fetchSpy).toHaveBeenCalledTimes(2); // 100 + 50
    });

    it('throws on HTTP 401 error', async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => '{"error": {"message": "Invalid API key"}}',
        } as unknown as Response);

        const provider = new OpenAIEmbeddingProvider('bad-key');
        await expect(provider.embed(['test'])).rejects.toThrow(/OpenAI embed failed.*401/);
    });

    it('dimensions() returns 1536', () => {
        const provider = new OpenAIEmbeddingProvider('test-key');
        expect(provider.dimensions()).toBe(1536);
    });

    it('modelName() returns text-embedding-3-small', () => {
        const provider = new OpenAIEmbeddingProvider('test-key');
        expect(provider.modelName()).toBe('text-embedding-3-small');
    });

    it('healthCheck() calls embed() with a short ping string', async () => {
        fetchSpy.mockResolvedValue(makeOpenAIResponse(['ping']));

        const provider = new OpenAIEmbeddingProvider('test-key');
        await expect(provider.healthCheck()).resolves.toBeUndefined();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// ── createEmbeddingProvider factory ──────────────────────────────────────────

describe('createEmbeddingProvider (factory)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns HuggingFaceEmbeddingProvider by default (no EMBEDDING_MODEL set)', () => {
        delete process.env['EMBEDDING_MODEL'];
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('local-codesage-large');
        expect(provider.dimensions()).toBe(1024);
    });

    it('returns HuggingFaceEmbeddingProvider when EMBEDDING_MODEL=huggingface', () => {
        process.env['EMBEDDING_MODEL'] = 'huggingface';
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('Salesforce/codesage-large');
        expect(provider.dimensions()).toBe(1024);
    });

    it('uses HF_MODEL env var when set', () => {
        process.env['EMBEDDING_MODEL'] = 'huggingface';
        process.env['HF_MODEL'] = 'Salesforce/codesage-large';
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('Salesforce/codesage-large');
    });

    it('uses HF_DIMENSIONS env var when set', () => {
        process.env['EMBEDDING_MODEL'] = 'huggingface';
        process.env['HF_DIMENSIONS'] = '1024';
        const provider = createEmbeddingProvider();
        expect(provider.dimensions()).toBe(1024);
    });

    it('returns OllamaEmbeddingProvider when EMBEDDING_MODEL=ollama', () => {
        process.env['EMBEDDING_MODEL'] = 'ollama';
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('nomic-embed-text');
    });

    it('uses OLLAMA_MODEL env var when set', () => {
        process.env['EMBEDDING_MODEL'] = 'ollama';
        process.env['OLLAMA_MODEL'] = 'mxbai-embed-large';
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('mxbai-embed-large');
    });

    it('returns OpenAIEmbeddingProvider when EMBEDDING_MODEL=openai and API key set', () => {
        process.env['EMBEDDING_MODEL'] = 'openai';
        process.env['OPENAI_API_KEY'] = 'sk-test';
        const provider = createEmbeddingProvider();
        expect(provider.modelName()).toBe('text-embedding-3-small');
        expect(provider.dimensions()).toBe(1536);
    });

    it('throws when EMBEDDING_MODEL=openai but OPENAI_API_KEY not set', () => {
        process.env['EMBEDDING_MODEL'] = 'openai';
        delete process.env['OPENAI_API_KEY'];
        expect(() => createEmbeddingProvider()).toThrow(/OPENAI_API_KEY/);
    });

    it('is case-insensitive for EMBEDDING_MODEL value', () => {
        process.env['EMBEDDING_MODEL'] = 'OPENAI';
        process.env['OPENAI_API_KEY'] = 'sk-test';
        const provider = createEmbeddingProvider();
        expect(provider.dimensions()).toBe(1536);
    });
});
