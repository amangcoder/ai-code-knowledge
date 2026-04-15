/**
 * Factory for creating EmbeddingProvider instances.
 *
 * Reads EMBEDDING_MODEL env var (default: 'local').
 * Supports local server, HuggingFace (CodeSage), Ollama, and OpenAI providers.
 */

import type { EmbeddingProvider } from './embedding-provider.js';
import { HuggingFaceEmbeddingProvider } from './huggingface-embedding-provider.js';
import { LocalEmbeddingProvider } from './local-embedding-provider.js';
import { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';

/**
 * Creates an EmbeddingProvider based on environment configuration.
 *
 * Environment variables:
 *   EMBEDDING_MODEL       — 'local' / 'local-base' (default, 768 dims), 'local-large' (1024 dims), 'huggingface', 'ollama', or 'openai'
 *   HF_MODEL              — HuggingFace model ID (default: 'Salesforce/codesage-large')
 *   HF_API_TOKEN          — Optional Bearer token for HuggingFace API
 *   HF_DIMENSIONS         — Embedding dimensions (default: 1024)
 *   OLLAMA_MODEL          — Ollama model name (default: 'nomic-embed-text')
 *   OLLAMA_BASE_URL       — Ollama base URL (default: 'http://localhost:11434')
 *   EMBEDDING_CONCURRENCY — Concurrent HTTP requests (default: 10)
 *   OPENAI_API_KEY        — Required when EMBEDDING_MODEL=openai
 *   LOCAL_EMBED_URL       — Local server URL (default: 'http://localhost:8484')
 *   LOCAL_EMBED_DIMS      — Local embedding dimensions (default: 1024)
 *
 * @throws if EMBEDDING_MODEL=openai and OPENAI_API_KEY is not set
 */
export function createEmbeddingProvider(): EmbeddingProvider {
    const model = (process.env['EMBEDDING_MODEL'] ?? 'local').toLowerCase().trim();

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
        const localUrl = process.env['LOCAL_EMBED_URL'] ?? 'http://localhost:8484';
        const localDims = parseInt(process.env['LOCAL_EMBED_DIMS'] ?? '768', 10);
        return new LocalEmbeddingProvider(localUrl, localDims);
    }

    if (model === 'local-large') {
        const localUrl = process.env['LOCAL_EMBED_URL'] ?? 'http://localhost:8484';
        const localDims = parseInt(process.env['LOCAL_EMBED_DIMS'] ?? '1024', 10);
        return new LocalEmbeddingProvider(localUrl, localDims);
    }

    if (model === 'ollama') {
        const ollamaModel = process.env['OLLAMA_MODEL'] ?? 'nomic-embed-text';
        const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
        const concurrency = parseInt(process.env['EMBEDDING_CONCURRENCY'] ?? '10', 10);
        return new OllamaEmbeddingProvider(ollamaModel, ollamaBaseUrl, 768, concurrency);
    }

    // Default: HuggingFace (CodeSage)
    const hfModel = process.env['HF_MODEL'] ?? 'Salesforce/codesage-base';
    const hfToken = process.env['HF_API_TOKEN'] ?? undefined;
    const dims = parseInt(process.env['HF_DIMENSIONS'] ?? '768', 10);

    return new HuggingFaceEmbeddingProvider(hfModel, hfToken, dims);
}

export type { EmbeddingProvider };
export { HuggingFaceEmbeddingProvider } from './huggingface-embedding-provider.js';
export { LocalEmbeddingProvider } from './local-embedding-provider.js';
export { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
export { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
