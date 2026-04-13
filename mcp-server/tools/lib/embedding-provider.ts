/**
 * Minimal EmbeddingProvider for the MCP server — makes HTTP calls to
 * HuggingFace (default, CodeSage), Ollama, or OpenAI to embed query strings
 * at search time.
 *
 * This is separate from scripts/lib/embeddings/ because tsconfig.mcp.json
 * uses rootDir="mcp-server" and cannot import from scripts/.
 *
 * Only the embed() method is needed for query-time search; upsert / batch
 * functionality lives in the build-pipeline providers (scripts/).
 */

/** Minimal interface needed by the MCP-server hybrid search path. */
export interface EmbeddingProvider {
    embed(texts: string[]): Promise<number[][]>;
    dimensions(): number;
    modelName(): string;
    /** Quick connectivity check — throws on failure. */
    healthCheck(): Promise<void>;
}

// ── Ollama provider ────────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private readonly model: string;
    private readonly baseUrl: string;
    private readonly _dimensions: number;

    constructor(
        model = 'nomic-embed-text',
        baseUrl = 'http://localhost:11434',
        dims = 768
    ) {
        this.model = model;
        this.baseUrl = baseUrl;
        this._dimensions = dims;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const text of texts) {
            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    // nomic-embed-text was trained with task-type prefixes
                    prompt: `search_query: ${text}`,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                throw new Error(
                    `Ollama embed failed: HTTP ${response.status} — ${response.statusText}`
                );
            }

            const data = (await response.json()) as { embedding: number[] };
            results.push(data.embedding);
        }
        return results;
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
    }
}

// ── OpenAI provider ────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private readonly model = 'text-embedding-3-small';
    private readonly _dimensions = 1536;
    private readonly apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
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

        return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }

    dimensions(): number {
        return this._dimensions;
    }

    modelName(): string {
        return this.model;
    }

    async healthCheck(): Promise<void> {
        // Lightweight: just embed a single short string to verify connectivity & key
        await this.embed(['ping']);
    }
}

// ── HuggingFace provider ──────────────────────────────────────────────────

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
    private readonly model: string;
    private readonly apiToken: string | undefined;
    private readonly _dimensions: number;
    private readonly endpoint: string;

    constructor(
        model = 'Salesforce/codesage-base',
        apiToken?: string,
        dims = 768
    ) {
        this.model = model;
        this.apiToken = apiToken;
        this._dimensions = dims;
        this.endpoint = `https://router.huggingface.co/pipeline/feature-extraction/${model}`;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        const results: number[][] = [];
        for (const text of texts) {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    inputs: text,
                    options: { wait_for_model: true },
                }),
                signal: AbortSignal.timeout(60_000),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(
                    `HuggingFace embed failed: HTTP ${response.status} — ${body}`
                );
            }

            const data = (await response.json()) as number[];
            results.push(data);
        }
        return results;
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

// ── Local (sentence_transformers server) provider ─────────────────────────

export class LocalEmbeddingProvider implements EmbeddingProvider {
    private readonly baseUrl: string;
    private readonly _dimensions: number;

    constructor(baseUrl = 'http://localhost:8484', dims = 768) {
        this.baseUrl = baseUrl;
        this._dimensions = dims;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.baseUrl}/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts }),
            signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `Local embedding server failed: HTTP ${response.status} — ${body}`
            );
        }

        const data = (await response.json()) as { embeddings: number[][] };
        return data.embeddings;
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

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates an EmbeddingProvider based on the EMBEDDING_MODEL env var.
 * Defaults to HuggingFace CodeSage-large when EMBEDDING_MODEL is unset.
 *
 * Environment variables:
 *   EMBEDDING_MODEL — 'local' / 'local-base' (default, 768 dims), 'local-large' (1024 dims), 'huggingface', 'ollama', or 'openai'
 *   HF_MODEL        — HuggingFace model ID (default: 'Salesforce/codesage-large')
 *   HF_API_TOKEN    — Optional Bearer token for HuggingFace API
 *   HF_DIMENSIONS   — Embedding dimensions (default: 1024)
 *   OLLAMA_MODEL    — Ollama model name (default: 'nomic-embed-text')
 *   OLLAMA_BASE_URL — Ollama base URL (default: 'http://localhost:11434')
 *   OPENAI_API_KEY  — Required when EMBEDDING_MODEL=openai
 *
 * @throws if EMBEDDING_MODEL=openai and OPENAI_API_KEY is not set
 */
export function createEmbeddingProvider(): EmbeddingProvider {
    const model = (process.env['EMBEDDING_MODEL'] ?? 'local').toLowerCase();

    if (model === 'openai') {
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
            throw new Error(
                'OPENAI_API_KEY environment variable is required when EMBEDDING_MODEL=openai'
            );
        }
        return new OpenAIEmbeddingProvider(apiKey);
    }

    if (model === 'local' || model === 'local-base') {
        return new LocalEmbeddingProvider(
            process.env['LOCAL_EMBED_URL'] ?? 'http://localhost:8484',
            parseInt(process.env['LOCAL_EMBED_DIMS'] ?? '768', 10)
        );
    }

    if (model === 'local-large') {
        return new LocalEmbeddingProvider(
            process.env['LOCAL_EMBED_URL'] ?? 'http://localhost:8484',
            parseInt(process.env['LOCAL_EMBED_DIMS'] ?? '1024', 10)
        );
    }

    if (model === 'ollama') {
        return new OllamaEmbeddingProvider(
            process.env['OLLAMA_MODEL'] ?? 'nomic-embed-text',
            process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
        );
    }

    // Default: HuggingFace (CodeSage)
    return new HuggingFaceEmbeddingProvider(
        process.env['HF_MODEL'] ?? 'Salesforce/codesage-base',
        process.env['HF_API_TOKEN'] ?? undefined,
        parseInt(process.env['HF_DIMENSIONS'] ?? '768', 10)
    );
}
