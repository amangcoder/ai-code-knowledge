/**
 * Local embedding provider backed by a Python sentence_transformers server.
 *
 * The server (scripts/embedding-server.py) loads CodeSage locally and exposes
 * POST /embed and GET /health endpoints. This avoids HuggingFace API rate
 * limits and runs entirely offline after the initial model download.
 *
 * Environment variables:
 *   LOCAL_EMBED_URL  — Server URL (default: 'http://localhost:8484')
 *   LOCAL_EMBED_DIMS — Embedding dimensions (default: 768)
 */

import type { EmbeddingProvider } from './embedding-provider.js';

const DEFAULT_BASE_URL = 'http://localhost:8484';
const DEFAULT_DIMENSIONS = 768;
const CHUNK_SIZE = 32;
const REQUEST_TIMEOUT = 120_000; // 120s — local inference can be slow on CPU

export class LocalEmbeddingProvider implements EmbeddingProvider {
    private readonly baseUrl: string;
    private readonly _dimensions: number;

    constructor(
        baseUrl: string = DEFAULT_BASE_URL,
        dims: number = DEFAULT_DIMENSIONS
    ) {
        this.baseUrl = baseUrl;
        this._dimensions = dims;
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
        const response = await fetch(`${this.baseUrl}/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `Local embedding server failed: HTTP ${response.status} — ${body}`
            );
        }

        const data = (await response.json()) as { embeddings: number[][] };
        return data.embeddings.map((embedding) => new Float32Array(embedding));
    }

    dimensions(): number {
        return this._dimensions;
    }

    modelName(): string {
        return 'local-codesage-base';
    }

    async healthCheck(): Promise<void> {
        const response = await fetch(`${this.baseUrl}/health`, {
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
            throw new Error(
                `Local embedding server not reachable at ${this.baseUrl} (HTTP ${response.status}). ` +
                `Start it with: python scripts/embedding-server.py`
            );
        }
    }
}
