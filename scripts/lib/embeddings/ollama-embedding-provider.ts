/**
 * Ollama-backed EmbeddingProvider for the build pipeline.
 *
 * Uses nomic-embed-text (768 dims) by default.
 * Prepends 'search_document:' prefix during indexing.
 * Implements semaphore-based concurrency limiting and batch chunking.
 */

import type { EmbeddingProvider } from './embedding-provider.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_CONCURRENCY = 10;
const CHUNK_SIZE = 32;

/** Simple semaphore for bounding concurrent HTTP requests. */
class Semaphore {
    private readonly limit: number;
    private current = 0;
    private readonly queue: Array<() => void> = [];

    constructor(limit: number) {
        this.limit = limit;
    }

    async acquire(): Promise<void> {
        if (this.current < this.limit) {
            this.current++;
            return;
        }
        await new Promise<void>((resolve) => this.queue.push(resolve));
        this.current++;
    }

    release(): void {
        this.current--;
        const next = this.queue.shift();
        if (next) next();
    }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private readonly model: string;
    private readonly baseUrl: string;
    private readonly _dimensions: number;
    private readonly semaphore: Semaphore;

    constructor(
        model: string = DEFAULT_MODEL,
        baseUrl: string = DEFAULT_BASE_URL,
        dims: number = DEFAULT_DIMENSIONS,
        concurrency: number = DEFAULT_CONCURRENCY
    ) {
        this.model = model;
        this.baseUrl = baseUrl;
        this._dimensions = dims;
        this.semaphore = new Semaphore(concurrency);
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        // Chunk into batches of CHUNK_SIZE
        const chunks: string[][] = [];
        for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
            chunks.push(texts.slice(i, i + CHUNK_SIZE));
        }

        const results: Float32Array[] = [];

        for (const chunk of chunks) {
            // Embed each text in the chunk concurrently (bounded by semaphore)
            const chunkEmbeddings = await Promise.all(
                chunk.map((text) => this._embedSingle(text))
            );
            results.push(...chunkEmbeddings);
        }

        return results;
    }

    private async _embedSingle(text: string): Promise<Float32Array> {
        await this.semaphore.acquire();
        try {
            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: `search_document: ${text}`,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                throw new Error(
                    `Ollama embed failed: HTTP ${response.status} — ${response.statusText}`
                );
            }

            const data = (await response.json()) as { embedding: number[] };
            return new Float32Array(data.embedding);
        } finally {
            this.semaphore.release();
        }
    }

    dimensions(): number {
        return this._dimensions;
    }

    modelName(): string {
        return this.model;
    }

    async healthCheck(): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
            throw new Error(
                `Ollama not reachable at ${this.baseUrl} (HTTP ${response.status})`
            );
        }

        // Verify the model is available
        const data = (await response.json()) as { models?: Array<{ name: string }> };
        const modelAvailable = data.models?.some(
            (m) => m.name === this.model || m.name.startsWith(this.model + ':')
        );
        if (!modelAvailable) {
            throw new Error(
                `Ollama model '${this.model}' not found. ` +
                `Run: ollama pull ${this.model}`
            );
        }
    }
}
