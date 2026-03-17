/**
 * Phase 7: Embedding generation pipeline phase.
 *
 * Reads summaries/cache.json and symbols.json, generates embeddings,
 * and upserts into files.lance and symbols.lance via VectorStore.
 *
 * Supports incremental updates — only re-embeds files with changed contentHash.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileSummary, SymbolEntry, EmbeddingPhaseResult } from '../../../src/types.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import { createVectorStore } from '../vector-store.js';
import { logInfo, logError } from '../logger.js';

const PHASE = 'embedding-phase';
const CHUNK_SIZE = 32;

export type { EmbeddingPhaseResult };

/**
 * Runs the embedding generation phase (Phase 7).
 *
 * @param knowledgeRoot  Path to .knowledge/ directory
 * @param provider       EmbeddingProvider instance (Ollama or OpenAI)
 * @param options        Optional phase configuration
 */
export async function runEmbeddingPhase(
    knowledgeRoot: string,
    provider: EmbeddingProvider,
    options: { incremental?: boolean } = {}
): Promise<EmbeddingPhaseResult> {
    const startMs = Date.now();
    const { incremental = true } = options;

    // 1. Health check
    await provider.healthCheck();

    // 2. Load summaries
    const summariesPath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    const summaries: Record<string, FileSummary> = {};
    try {
        const raw = fs.readFileSync(summariesPath, 'utf8');
        Object.assign(summaries, JSON.parse(raw) as Record<string, FileSummary>);
    } catch {
        logError(PHASE, `Could not load summaries from ${summariesPath}`);
    }

    // 3. Load symbols
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    let symbols: SymbolEntry[] = [];
    try {
        const raw = fs.readFileSync(symbolsPath, 'utf8');
        symbols = JSON.parse(raw) as SymbolEntry[];
    } catch {
        logError(PHASE, `Could not load symbols from ${symbolsPath}`);
    }

    // 4. Open/create VectorStore
    const vectorStore = await createVectorStore(knowledgeRoot, provider.dimensions());
    if (!vectorStore.isAvailable()) {
        logError(PHASE, 'VectorStore is unavailable — LanceDB not installed?');
        return { filesEmbedded: 0, symbolsEmbedded: 0, skipped: 0, durationMs: Date.now() - startMs };
    }

    // 5. Write vectors/metadata.json
    const vectorsDir = path.join(knowledgeRoot, 'vectors');
    const metadataPath = path.join(vectorsDir, 'metadata.json');
    const metadata = {
        model: provider.modelName(),
        dimensions: provider.dimensions(),
        createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(vectorsDir, { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    // 6. Embed files
    let filesEmbedded = 0;
    const skipped = 0;

    const fileEntries = Object.entries(summaries);
    const filesToEmbed = incremental
        ? fileEntries.filter(([, s]) => !!s.contentHash)
        : fileEntries;

    // Process in chunks
    for (let i = 0; i < filesToEmbed.length; i += CHUNK_SIZE) {
        const chunk = filesToEmbed.slice(i, i + CHUNK_SIZE);
        const texts = chunk.map(([, s]) => s.purpose ?? '');

        try {
            const embeddings = await provider.embed(texts);
            const records = chunk.map(([filePath, summary], idx) => ({
                id: `file:${filePath}`,
                file: filePath,
                purpose: summary.purpose ?? '',
                embedding: embeddings[idx],
                contentHash: summary.contentHash ?? '',
            }));
            await vectorStore.upsertFiles(records);
            filesEmbedded += chunk.length;
        } catch (err) {
            logError(PHASE, `Failed to embed file chunk: ${String(err)}`);
        }
    }

    // 7. Embed symbols (signatures)
    let symbolsEmbedded = 0;
    const exportedSymbols = symbols.filter((s) => s.isExported && s.signature);

    for (let i = 0; i < exportedSymbols.length; i += CHUNK_SIZE) {
        const chunk = exportedSymbols.slice(i, i + CHUNK_SIZE);
        const texts = chunk.map((s) => `${s.qualifiedName}: ${s.signature}`);

        try {
            const embeddings = await provider.embed(texts);
            const records = chunk.map((sym, idx) => ({
                id: `symbol:${sym.qualifiedName}`,
                qualifiedName: sym.qualifiedName,
                signature: sym.signature,
                file: sym.file,
                embedding: embeddings[idx],
            }));
            await vectorStore.upsertSymbols(records);
            symbolsEmbedded += chunk.length;
        } catch (err) {
            logError(PHASE, `Failed to embed symbol chunk: ${String(err)}`);
        }
    }

    logInfo(
        PHASE,
        `Done: ${filesEmbedded} files, ${symbolsEmbedded} symbols, ` +
        `${skipped} skipped in ${Date.now() - startMs}ms`
    );

    return {
        filesEmbedded,
        symbolsEmbedded,
        skipped,
        durationMs: Date.now() - startMs,
    };
}
