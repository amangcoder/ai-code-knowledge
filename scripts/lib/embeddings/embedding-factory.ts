/**
 * Factory for creating EmbeddingProvider instances.
 *
 * Reads EMBEDDING_MODEL env var (default: 'ollama').
 * Also reads OLLAMA_MODEL, OLLAMA_BASE_URL, EMBEDDING_CONCURRENCY for Ollama config.
 * Reads OPENAI_API_KEY for OpenAI config.
 */

import type { EmbeddingProvider } from './embedding-provider.js';
import { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';

/**
 * Creates an EmbeddingProvider based on environment configuration.
 *
 * Environment variables:
 *   EMBEDDING_MODEL   — 'ollama' (default) or 'openai'
 *   OLLAMA_MODEL      — Ollama model name (default: 'nomic-embed-text')
 *   OLLAMA_BASE_URL   — Ollama base URL (default: 'http://localhost:11434')
 *   EMBEDDING_CONCURRENCY — concurrent HTTP requests for Ollama (default: 10)
 *   OPENAI_API_KEY    — required when EMBEDDING_MODEL=openai
 *
 * @throws if EMBEDDING_MODEL=openai and OPENAI_API_KEY is not set
 */
export function createEmbeddingProvider(): EmbeddingProvider {
    const model = (process.env['EMBEDDING_MODEL'] ?? 'ollama').toLowerCase().trim();

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
    const ollamaModel = process.env['OLLAMA_MODEL'] ?? 'nomic-embed-text';
    const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
    const concurrency = parseInt(process.env['EMBEDDING_CONCURRENCY'] ?? '10', 10);

    return new OllamaEmbeddingProvider(ollamaModel, ollamaBaseUrl, 768, concurrency);
}

export type { EmbeddingProvider };
export { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
export { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
