/**
 * Phase 9: Feature discovery pipeline phase.
 *
 * Loads file embeddings from VectorStore, clusters them, generates feature
 * summaries via LLM, and writes features/index.json and features/cache.json.
 *
 * Controlled by --skip-features and --rebuild-features flags.
 * Degrades gracefully if embedding or summarization fails.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    FileSummary,
    SymbolEntry,
    FeatureDiscoveryResult,
} from '../../../src/types.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { Summarizer } from '../summarizer.js';
import { createVectorStore } from '../vector-store.js';
import { discoverFeatures, writeFeatures } from '../feature-discovery.js';
import { logInfo, logError } from '../logger.js';

const PHASE = 'feature-discovery-phase';

export type { FeatureDiscoveryResult };

/**
 * Runs the feature discovery phase (Phase 9).
 *
 * @param knowledgeRoot  Path to .knowledge/ directory
 * @param provider       EmbeddingProvider for embedding feature descriptions
 * @param summarizer     LLM summarizer for generating feature names/descriptions
 * @param options        Optional phase configuration
 */
export async function runFeatureDiscoveryPhase(
    knowledgeRoot: string,
    provider: EmbeddingProvider,
    summarizer: Summarizer,
    options: { rebuildFeatures?: boolean } = {}
): Promise<FeatureDiscoveryResult> {
    const startMs = Date.now();

    // 1. Load summaries (for feature prompts)
    const summariesPath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    const summaries: Record<string, FileSummary> = {};
    try {
        const raw = fs.readFileSync(summariesPath, 'utf8');
        Object.assign(summaries, JSON.parse(raw) as Record<string, FileSummary>);
    } catch {
        logError(PHASE, `Could not load summaries from ${summariesPath}`);
    }

    // 2. Load symbols (for feature prompts)
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    let symbols: SymbolEntry[] = [];
    try {
        const raw = fs.readFileSync(symbolsPath, 'utf8');
        symbols = JSON.parse(raw) as SymbolEntry[];
    } catch {
        logError(PHASE, `Could not load symbols from ${symbolsPath}`);
    }

    // 3. Load file embeddings from VectorStore
    const vectorStore = await createVectorStore(knowledgeRoot, provider.dimensions());
    const embeddings = await vectorStore.getAllFileEmbeddings();

    // 4. If embeddings unavailable, generate from summaries
    if (embeddings.size === 0 && Object.keys(summaries).length > 0) {
        logInfo(PHASE, 'No stored embeddings found — generating from summaries');
        try {
            const texts = Object.entries(summaries).map(([, s]) => s.purpose ?? '');
            const embeddingArrays = await provider.embed(texts);
            Object.entries(summaries).forEach(([filePath], idx) => {
                embeddings.set(filePath, embeddingArrays[idx]);
            });
        } catch (err) {
            logError(PHASE, `Failed to generate embeddings: ${String(err)}`);
            return { featuresDiscovered: 0, durationMs: Date.now() - startMs };
        }
    }

    if (embeddings.size === 0) {
        logInfo(PHASE, 'No embeddings available — skipping feature discovery');
        return { featuresDiscovered: 0, durationMs: Date.now() - startMs };
    }

    // 5. Discover features
    let features;
    try {
        features = await discoverFeatures(embeddings, summaries, symbols, summarizer);
    } catch (err) {
        logError(PHASE, `Feature discovery failed: ${String(err)}`);
        return { featuresDiscovered: 0, durationMs: Date.now() - startMs };
    }

    // 6. Write features to disk
    try {
        await writeFeatures(knowledgeRoot, features);
    } catch (err) {
        logError(PHASE, `Failed to write features: ${String(err)}`);
    }

    // 7. Embed feature descriptions and upsert into features.lance
    if (features.length > 0 && vectorStore.isAvailable()) {
        try {
            const featureTexts = features.map((f) => f.description);
            const featureEmbeddings = await provider.embed(featureTexts);
            const records = features.map((f, idx) => ({
                id: f.id,
                name: f.name,
                description: f.description,
                embedding: featureEmbeddings[idx],
            }));
            await vectorStore.upsertFeatures(records);
        } catch (err) {
            logError(PHASE, `Failed to embed/upsert features: ${String(err)}`);
        }
    }

    const durationMs = Date.now() - startMs;
    logInfo(PHASE, `Done: ${features.length} features discovered in ${durationMs}ms`);

    return {
        featuresDiscovered: features.length,
        durationMs,
    };
}
