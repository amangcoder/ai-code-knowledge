/**
 * OpenAI-backed EmbeddingProvider for the build pipeline.
 *
 * Uses text-embedding-3-small (1536 dims).
 * Reads API key from OPENAI_API_KEY environment variable.
 * Returns Float32Array[] as required by LanceDB.
 */

import type { EmbeddingProvider } from './embedding-provider.js';

const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_DIMENSIONS = 1536;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const CHUNK_SIZE = 100; // OpenAI supports up to 2048 inputs per request

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private readonly apiKey: string;
    private readonly model: string;
    private readonly _dimensions: number;

    constructor(apiKey: string, model: string = OPENAI_MODEL, dims: number = OPENAI_DIMENSIONS) {
        if (!apiKey) {
            throw new Error(
                'OPENAI_API_KEY environment variable is required when using OpenAI embedding provider'
            );
        }
        this.apiKey = apiKey;
        this.model = model;
        this._dimensions = dims;
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        const results: Float32Array[] = [];

        // Process in chunks to respect rate limits
        for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
            const chunk = texts.slice(i, i + CHUNK_SIZE);
            const chunkResults = await this._embedBatch(chunk);
            results.push(...chunkResults);
        }

        return results;
    }

    private async _embedBatch(texts: string[]): Promise<Float32Array[]> {
        const response = await fetch(OPENAI_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: texts }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`OpenAI embed failed: HTTP ${response.status} — ${body}`);
        }

        const data = (await response.json()) as {
            data: Array<{ embedding: number[]; index: number }>;
        };

        // Sort by index to maintain original order
        return data.data
            .sort((a, b) => a.index - b.index)
            .map((d) => new Float32Array(d.embedding));
    }

    dimensions(): number {
        return this._dimensions;
    }

    modelName(): string {
        return this.model;
    }

    async healthCheck(): Promise<void> {
        // Lightweight: embed a single short string to verify connectivity & key
        await this.embed(['ping']);
    }
}
