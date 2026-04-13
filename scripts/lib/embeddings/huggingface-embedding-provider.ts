/**
 * HuggingFace Inference API-backed EmbeddingProvider for the build pipeline.
 *
 * Uses Salesforce/codesage-base (768 dims) by default — a code-optimized
 * embedding model that outperforms general-purpose embeddings on
 * code-to-code search tasks.
 *
 * The HF Inference API supports batch inputs natively. Texts are chunked
 * into groups of CHUNK_SIZE and sent as batched requests.
 *
 * Environment variables:
 *   HF_MODEL      — HuggingFace model ID (default: 'Salesforce/codesage-base')
 *   HF_API_TOKEN  — Optional Bearer token for higher rate limits
 *   HF_DIMENSIONS — Embedding dimensions (default: 768)
 */

import type { EmbeddingProvider } from './embedding-provider.js';

const DEFAULT_MODEL = 'Salesforce/codesage-base';
const DEFAULT_DIMENSIONS = 768;
const BASE_URL = 'https://api-inference.huggingface.co/pipeline/feature-extraction';
const CHUNK_SIZE = 32;
const REQUEST_TIMEOUT = 60_000; // 60s — cold starts can be slow

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
    private readonly model: string;
    private readonly apiToken: string | undefined;
    private readonly _dimensions: number;
    private readonly endpoint: string;

    constructor(
        model: string = DEFAULT_MODEL,
        apiToken?: string,
        dims: number = DEFAULT_DIMENSIONS
    ) {
        this.model = model;
        this.apiToken = apiToken;
        this._dimensions = dims;
        this.endpoint = `${BASE_URL}/${model}`;
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        const results: Float32Array[] = [];

        for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
            const chunk = texts.slice(i, i + CHUNK_SIZE);
            const chunkResults = await this._embedBatch(chunk);
            results.push(...chunkResults);
        }

        return results;
    }

    private async _embedBatch(texts: string[]): Promise<Float32Array[]> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                inputs: texts,
                options: { wait_for_model: true },
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `HuggingFace embed failed: HTTP ${response.status} — ${body}`
            );
        }

        const data = (await response.json()) as number[][];
        return data.map((embedding) => new Float32Array(embedding));
    }

    dimensions(): number {
        return this._dimensions;
    }

    modelName(): string {
        return this.model;
    }

    async healthCheck(): Promise<void> {
        await this.embed(['ping']);
    }
}
