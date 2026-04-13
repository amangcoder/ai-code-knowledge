/**
 * find_template_file MCP tool handler.
 *
 * When VectorStore is available (Phase 7 embeddings built), uses ANN vector
 * similarity search over files.lance to find the most semantically similar
 * existing files to use as templates.
 *
 * Falls back to token-matching against the summary cache when vectors are
 * unavailable, preserving full backwards-compatibility.
 *
 * Response is formatted via buildResponse()/Section pattern, matching the
 * conventions used by all other tools in this directory.
 */
import * as path from 'node:path';
import { loadSummaryCache, loadVectorStore, loadIndex } from './lib/data-loader.js';
import { buildResponse } from './lib/response-budget.js';
import { createEmbeddingProvider } from './lib/embedding-provider.js';
import { resolveProjectRoot } from './lib/path-utils.js';
import { buildFooterSection } from './lib/metadata-footer.js';
/** Number of vector-similarity results to request from the files table. */
const VECTOR_TOP_K = 5;
/** Maximum token-match results to return in the fallback path. */
const TOKEN_TOP_K = 3;
/** Response byte budget — 12 KB matches other targeted-search tools. */
const TOOL_BUDGET = 12_000;
const STOPWORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'for', 'to', 'of', 'in', 'on',
    'with', 'and', 'or', 'that', 'this', 'it', 'as', 'at', 'by',
    'from', 'be', 'was', 'has', 'have', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'page', 'file',
]);
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/[\s/\-_]+/)
        .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}
// ── Vector search path ────────────────────────────────────────────────────────
/**
 * Performs ANN similarity search over the files vector table.
 * Called when the VectorStore is available.
 *
 * On embedding failure (e.g. Ollama not running) gracefully falls back to
 * the token-matching path so the tool remains useful in offline environments.
 */
async function vectorSearch(description, knowledgeRoot, vectorStore, index, projectRoot) {
    // Create embedding provider — falls back to token search if misconfigured
    let embeddingProvider;
    try {
        embeddingProvider = createEmbeddingProvider();
    }
    catch {
        // Configuration error (e.g. missing OPENAI_API_KEY): degrade gracefully
        process.stderr.write('[find-template-file] EmbeddingProvider unavailable — falling back to token matching\n');
        return tokenMatchSearch(description, knowledgeRoot, index, projectRoot);
    }
    // Embed the description query
    let embedding;
    try {
        [embedding] = await embeddingProvider.embed([description]);
    }
    catch {
        // Network / embedding provider connectivity error: degrade gracefully
        process.stderr.write('[find-template-file] Embedding request failed — falling back to token matching\n');
        return tokenMatchSearch(description, knowledgeRoot, index, projectRoot);
    }
    // ANN search over files.lance
    const results = await vectorStore.searchFiles(embedding, VECTOR_TOP_K);
    if (results.length === 0) {
        // Vector index exists but returned no matches — fall back for better coverage
        return tokenMatchSearch(description, knowledgeRoot, index, projectRoot);
    }
    // Format results into sections
    const sections = [];
    sections.push({
        label: '',
        content: `=== Template Suggestions for: "${description}" ===`,
        priority: 0,
    });
    const resultLines = [];
    for (const result of results) {
        // VectorStore ids are prefixed 'file:<relPath>'
        const relPath = result.id.startsWith('file:')
            ? result.id.slice('file:'.length)
            : result.id;
        const purpose = result.metadata['purpose'] ??
            result.metadata['llmDescription'] ??
            result.metadata['detailedPurpose'] ??
            '';
        const exports = result.metadata['exports'] ?? '';
        const scoreStr = result.score.toFixed(4);
        resultLines.push(`File: ${relPath}`);
        if (purpose) {
            resultLines.push(`Purpose: ${purpose}`);
        }
        if (exports) {
            resultLines.push(`Exports: ${exports}`);
        }
        resultLines.push(`Score: ${scoreStr}`);
        resultLines.push('');
    }
    sections.push({
        label: `Results (${results.length})`,
        content: resultLines.join('\n').trimEnd(),
        priority: 1,
    });
    sections.push(buildFooterSection(index, projectRoot));
    return {
        content: [{ type: 'text', text: buildResponse(sections, TOOL_BUDGET) }],
    };
}
// ── Token-matching fallback ───────────────────────────────────────────────────
/**
 * Token-matching search over the summary cache.
 * Used when VectorStore is unavailable (embeddings not yet built).
 * Now formatted with buildResponse()/Section like all other tools.
 */
function tokenMatchSearch(description, knowledgeRoot, index, projectRoot) {
    const cache = loadSummaryCache(knowledgeRoot);
    if (cache === null) {
        const cachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: Summary cache not found at ${cachePath}.\nRun 'npm run build-knowledge' to generate the knowledge artifacts first.`,
                },
            ],
            isError: true,
        };
    }
    const tokens = tokenize(description);
    const uniqueTokens = [...new Set(tokens)];
    const scored = [];
    for (const [filePath, summary] of Object.entries(cache)) {
        const combined = summary.purpose.toLowerCase() +
            ' ' +
            summary.file.toLowerCase() +
            ' ' +
            summary.exports.join(' ').toLowerCase();
        let score = 0;
        for (const token of uniqueTokens) {
            if (combined.includes(token)) {
                score++;
            }
        }
        if (score > 0) {
            scored.push({ file: filePath, summary, score });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOKEN_TOP_K);
    const sections = [];
    sections.push({
        label: '',
        content: `=== Template Suggestions for: "${description}" ===`,
        priority: 0,
    });
    if (top.length === 0) {
        sections.push({
            label: '',
            content: 'No matching files found. Try different keywords.',
            priority: 1,
        });
        sections.push(buildFooterSection(index, projectRoot));
        return {
            content: [{ type: 'text', text: buildResponse(sections, TOOL_BUDGET) }],
        };
    }
    const resultLines = [];
    for (const match of top) {
        resultLines.push(`File: ${match.summary.file}`);
        resultLines.push(`Purpose: ${match.summary.purpose}`);
        if (match.summary.exports && match.summary.exports.length > 0) {
            resultLines.push(`Exports: ${match.summary.exports.join(', ')}`);
        }
        else {
            resultLines.push('Exports: (none)');
        }
        resultLines.push(`Score: ${match.score}`);
        resultLines.push('');
    }
    sections.push({
        label: `Results (${top.length})`,
        content: resultLines.join('\n').trimEnd(),
        priority: 1,
    });
    sections.push(buildFooterSection(index, projectRoot));
    return {
        content: [{ type: 'text', text: buildResponse(sections, TOOL_BUDGET) }],
    };
}
// ── Handler ───────────────────────────────────────────────────────────────────
/**
 * Handler for the `find_template_file` MCP tool.
 *
 * Given a plain-English description, finds the most similar existing files to
 * use as templates for new code, helping maintain consistency with codebase
 * conventions.
 *
 * Strategy selection:
 *   1. Vector similarity (ANN over files.lance) when VectorStore is available
 *   2. Token-matching over summary cache when vectors are unavailable
 *
 * Both paths use the buildResponse()/Section pattern for budget-aware output.
 */
export async function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    // ── Input validation ─────────────────────────────────────────────────────
    const description = (args.description ?? '').trim();
    if (!description) {
        return {
            content: [{ type: 'text', text: 'description parameter is required and must not be empty.' }],
            isError: true,
        };
    }
    // ── Load knowledge index (needed for footer + cache availability check) ──
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        // No index.json — knowledge base has not been built
        const cachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: Summary cache not found at ${cachePath}.\nRun 'npm run build-knowledge' to generate the knowledge artifacts first.`,
                },
            ],
            isError: true,
        };
    }
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    // ── Attempt vector similarity search ────────────────────────────────────
    const vectorStore = await loadVectorStore(knowledgeRoot);
    if (vectorStore !== null && vectorStore.isAvailable()) {
        return vectorSearch(description, knowledgeRoot, vectorStore, index, projectRoot);
    }
    // ── Fallback: token-matching ─────────────────────────────────────────────
    return tokenMatchSearch(description, knowledgeRoot, index, projectRoot);
}
