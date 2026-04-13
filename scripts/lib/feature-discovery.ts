/**
 * FeatureDiscovery — clusters file embeddings and generates LLM-powered feature summaries.
 *
 * Provides:
 *  - discoverFeatures(embeddings, summaries, symbols, summarizer) — main entry point
 *  - clusterEmbeddings(embeddings, k?) — re-exported from clustering.ts
 *  - loadFeatures(knowledgeRoot) — reads features/index.json
 *  - writeFeatures(knowledgeRoot, features) — writes features/index.json and features/cache.json
 *
 * Feature summaries are generated via the Summarizer interface, not direct LLM calls.
 * Unchanged clusters (same file set hash) are skipped for re-summarization.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { FileSummary, SymbolEntry, FeatureGroup } from '../../src/types.js';
import type { Summarizer } from './summarizer.js';
import { clusterEmbeddings } from './clustering.js';
import { atomicWrite } from './atomic-writer.js';

export { clusterEmbeddings };

// ── Cache digest helpers ─────────────────────────────────────────────────────

/** Compute a digest for a cluster (sorted file IDs). Used to detect unchanged clusters. */
function clusterDigest(fileIds: string[]): string {
    return crypto.createHash('sha256').update([...fileIds].sort().join('\0')).digest('hex');
}

// ── Feature summary prompt ───────────────────────────────────────────────────

function buildFeaturePrompt(
    clusterFiles: string[],
    summaries: Record<string, FileSummary>,
    symbols: SymbolEntry[]
): string {
    const filePurposes = clusterFiles
        .map((f) => `- ${f}: ${summaries[f]?.purpose ?? 'unknown purpose'}`)
        .join('\n');

    const clusterSymbols = symbols
        .filter((s) => clusterFiles.some((f) => s.file.endsWith(f) || s.file === f))
        .slice(0, 20)
        .map((s) => s.qualifiedName)
        .join(', ');

    return `Analyze this group of related source files and identify the cross-cutting feature or capability they implement.

Files in this cluster:
${filePurposes}

Key symbols: ${clusterSymbols || 'none'}

Provide a JSON object with:
{
  "name": "feature name (1-3 words, e.g. 'Payment Processing')",
  "description": "1-2 sentences describing this feature's responsibility",
  "entryPoints": ["main exported function/class names that external code calls"],
  "dataFlow": "brief description of data flow through this feature",
  "keySymbols": ["up to 5 most important symbol qualified names"]
}

Output ONLY valid JSON.`;
}

/** Parse LLM response into feature fields. */
function parseFeatureResponse(raw: string): Partial<FeatureGroup> {
    try {
        const jsonMatch = /\{[\s\S]*\}/.exec(raw);
        if (!jsonMatch) return {};
        const parsed = JSON.parse(jsonMatch[0]) as Partial<FeatureGroup>;
        return {
            name: typeof parsed.name === 'string' ? parsed.name : 'Unknown Feature',
            description: typeof parsed.description === 'string' ? parsed.description : '',
            entryPoints: Array.isArray(parsed.entryPoints) ? parsed.entryPoints : [],
            dataFlow: typeof parsed.dataFlow === 'string' ? parsed.dataFlow : '',
            keySymbols: Array.isArray(parsed.keySymbols) ? parsed.keySymbols : [],
        };
    } catch {
        return {};
    }
}

// ── Cache file types ─────────────────────────────────────────────────────────

interface FeatureCacheEntry {
    digest: string;
    feature: FeatureGroup;
}

// ── Main exports ─────────────────────────────────────────────────────────────

/**
 * Discover cross-cutting features from file embeddings.
 *
 * @param embeddings  Map from relative file path to embedding vector
 * @param summaries   File summary map (keyed by relative path)
 * @param symbols     All extracted symbols (for generating feature prompts)
 * @param summarizer  LLM-powered summarizer (mocked in tests)
 * @returns           Array of discovered FeatureGroups
 */
export async function discoverFeatures(
    embeddings: Map<string, Float32Array>,
    summaries: Record<string, FileSummary>,
    symbols: SymbolEntry[],
    summarizer: Summarizer,
    existingCache?: Map<string, FeatureCacheEntry>
): Promise<FeatureGroup[]> {
    if (embeddings.size === 0) return [];

    // Cluster embeddings
    const clusters = clusterEmbeddings(embeddings);
    const features: FeatureGroup[] = [];

    for (const [clusterId, fileIds] of clusters) {
        const digest = clusterDigest(fileIds);

        // Check cache — skip re-summarization if cluster unchanged
        const cached = existingCache?.get(String(clusterId));
        if (cached && cached.digest === digest) {
            features.push(cached.feature);
            continue;
        }

        // Build prompt and summarize
        const prompt = buildFeaturePrompt(fileIds, summaries, symbols);

        let parsed: Partial<FeatureGroup> = {};
        try {
            // We misuse the Summarizer here: pass the prompt as file content
            // (StaticSummarizer ignores content, LLM summarizers will use it)
            const summary = await summarizer.summarizeFile(
                `feature-cluster-${clusterId}`,
                prompt,
                []
            );
            // The purpose field of the FileSummary holds our JSON response
            parsed = parseFeatureResponse(summary.purpose ?? prompt);
        } catch {
            // Graceful degradation
        }

        const featureId = `cluster-${clusterId}`;
        const feature: FeatureGroup = {
            id: featureId,
            name: parsed.name ?? `Feature ${clusterId + 1}`,
            description: parsed.description ?? `Cross-cutting feature involving ${fileIds.length} files`,
            files: fileIds,
            entryPoints: parsed.entryPoints ?? [],
            dataFlow: parsed.dataFlow ?? '',
            keySymbols: parsed.keySymbols ?? [],
            relatedFeatures: [],
        };

        features.push(feature);
    }

    // Populate relatedFeatures (features that share files)
    for (let i = 0; i < features.length; i++) {
        const aFiles = new Set(features[i].files);
        for (let j = 0; j < features.length; j++) {
            if (i === j) continue;
            const hasOverlap = features[j].files.some((f) => aFiles.has(f));
            if (hasOverlap) features[i].relatedFeatures.push(features[j].id);
        }
    }

    return features;
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Load features from features/index.json under knowledgeRoot.
 * Returns null if the file does not exist or is unreadable.
 */
export function loadFeatures(knowledgeRoot: string): FeatureGroup[] | null {
    const indexPath = path.join(knowledgeRoot, 'features', 'index.json');
    try {
        const raw = fs.readFileSync(indexPath, 'utf8');
        return JSON.parse(raw) as FeatureGroup[];
    } catch {
        return null;
    }
}

/**
 * Atomically write features to features/index.json and features/cache.json.
 */
export async function writeFeatures(
    knowledgeRoot: string,
    features: FeatureGroup[]
): Promise<void> {
    const featuresDir = path.join(knowledgeRoot, 'features');
    fs.mkdirSync(featuresDir, { recursive: true });

    await atomicWrite(
        path.join(featuresDir, 'index.json'),
        JSON.stringify(features, null, 2)
    );

    // Write cache (same content for now — future: could store per-cluster digests)
    await atomicWrite(
        path.join(featuresDir, 'cache.json'),
        JSON.stringify(features, null, 2)
    );
}
