/**
 * Minimal EmbeddingProvider for the MCP server — makes HTTP calls to
 * Ollama (default) or OpenAI to embed query strings at search time.
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

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates an EmbeddingProvider based on the EMBEDDING_MODEL env var.
 * Defaults to Ollama nomic-embed-text when EMBEDDING_MODEL is unset.
 *
 * @throws if EMBEDDING_MODEL=openai and OPENAI_API_KEY is not set
 */
export function createEmbeddingProvider(): EmbeddingProvider {
    const model = (process.env['EMBEDDING_MODEL'] ?? 'ollama').toLowerCase();

    if (model === 'openai') {
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
            throw new Error(
                'OPENAI_API_KEY environment variable is required when EMBEDDING_MODEL=openai'
            );
        }
        return new OpenAIEmbeddingProvider(apiKey);
    }

    // Default: Ollama
    return new OllamaEmbeddingProvider(
        process.env['OLLAMA_MODEL'] ?? 'nomic-embed-text',
        process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
    );
}
