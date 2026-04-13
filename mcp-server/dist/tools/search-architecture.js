import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSummaryCache, loadSymbols, loadIndex } from './lib/data-loader.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { resolveProjectRoot, toRelative } from './lib/path-utils.js';
const CONTEXT_LINES = 3;
/**
 * Merges overlapping or adjacent line ranges into consolidated ranges.
 * Each range is [start, end] inclusive (0-based indices).
 */
function mergeRanges(ranges) {
    if (ranges.length === 0)
        return [];
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current[0] <= last[1] + 1) {
            // Overlapping or adjacent — extend the last range
            last[1] = Math.max(last[1], current[1]);
        }
        else {
            merged.push(current);
        }
    }
    return merged;
}
/** Searches architecture.md for the query. Continues on ENOENT. */
function searchArchitectureDoc(knowledgeRoot, query) {
    const architecturePath = path.join(knowledgeRoot, 'architecture.md');
    let content;
    try {
        content = fs.readFileSync(architecturePath, 'utf-8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return []; // Continue without architecture.md
        }
        return [];
    }
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();
    const matchingIndices = [];
    for (let i = 0; i < lines.length; i++) {
        // Use string.includes() — NOT RegExp (avoids ReDoS)
        if (lines[i].toLowerCase().includes(queryLower)) {
            matchingIndices.push(i);
        }
    }
    if (matchingIndices.length === 0)
        return [];
    const contextRanges = matchingIndices.map((idx) => [
        Math.max(0, idx - CONTEXT_LINES),
        Math.min(lines.length - 1, idx + CONTEXT_LINES),
    ]);
    const mergedRanges = mergeRanges(contextRanges);
    return mergedRanges.map(([start, end]) => {
        const block = [];
        for (let i = start; i <= end; i++) {
            block.push(`[architecture.md:${i + 1}] ${lines[i]}`);
        }
        return {
            source: 'architecture-doc',
            label: `architecture.md (lines ${start + 1}-${end + 1})`,
            snippet: block.join('\n'),
        };
    });
}
/** Searches summaryCache llmDescription/detailedPurpose fields. */
function searchFileSummaries(knowledgeRoot, query, projectRoot) {
    const cache = loadSummaryCache(knowledgeRoot);
    if (!cache)
        return [];
    const queryLower = query.toLowerCase();
    const results = [];
    const seen = new Set();
    for (const [filePath, summary] of Object.entries(cache)) {
        const desc = summary.llmDescription ?? summary.detailedPurpose ?? summary.purpose ?? '';
        if (desc.toLowerCase().includes(queryLower)) {
            const snippet = desc.length > 200 ? desc.slice(0, 197) + '...' : desc;
            if (!seen.has(snippet)) {
                seen.add(snippet);
                const relPath = toRelative(filePath, projectRoot);
                results.push({
                    source: 'file-summary',
                    label: relPath !== '(external)' ? relPath : filePath,
                    snippet: `[file-summary] ${relPath !== '(external)' ? relPath : filePath}: ${snippet}`,
                });
            }
        }
    }
    return results;
}
/** Searches symbol JSDoc fields. */
function searchSymbolJsdoc(knowledgeRoot, query, projectRoot) {
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols)
        return [];
    const queryLower = query.toLowerCase();
    const results = [];
    const seen = new Set();
    for (const sym of symbols) {
        if (!sym.jsdoc)
            continue;
        if (sym.jsdoc.toLowerCase().includes(queryLower)) {
            const relFile = toRelative(sym.file, projectRoot);
            const firstLine = sym.jsdoc
                .replace(/^\/\*\*\s*/, '')
                .split('\n')
                .map(l => l.replace(/^\s*\*\s?/, '').trim())
                .find(l => l.length > 0) ?? '';
            const snippet = `[symbol-jsdoc] ${relFile}::${sym.name} — ${firstLine}`;
            if (!seen.has(snippet)) {
                seen.add(snippet);
                results.push({
                    source: 'symbol-jsdoc',
                    label: `${relFile}::${sym.name}`,
                    snippet,
                });
            }
        }
    }
    return results;
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const query = args.query;
    const index = loadIndex(knowledgeRoot);
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    // Search all three sources — use string.includes(), NOT RegExp
    const archResults = searchArchitectureDoc(knowledgeRoot, query);
    const summaryResults = searchFileSummaries(knowledgeRoot, query, projectRoot);
    const jsdocResults = searchSymbolJsdoc(knowledgeRoot, query, projectRoot);
    // Sort by source priority: architecture-doc first, then file-summary, then symbol-jsdoc
    const allResults = [
        ...archResults,
        ...summaryResults,
        ...jsdocResults,
    ];
    if (allResults.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: [
                        `No results found for "${query}".`,
                        '',
                        `Searched sources:`,
                        `  - architecture.md (${archResults.length > 0 ? 'found matches' : 'no matches or not found'})`,
                        `  - file summaries (llmDescription/detailedPurpose)`,
                        `  - symbol JSDoc comments`,
                        '',
                        `Try: get_project_overview() for an overview, or find_symbol(name="${query}") for symbols.`,
                    ].join('\n'),
                }],
        };
    }
    const sections = [];
    // Results by source type
    if (archResults.length > 0) {
        sections.push({
            label: `Architecture Doc (${archResults.length} match${archResults.length !== 1 ? 'es' : ''})`,
            content: archResults.map(r => r.snippet).join('\n\n'),
            priority: 0,
        });
    }
    if (summaryResults.length > 0) {
        sections.push({
            label: `File Summaries (${summaryResults.length} match${summaryResults.length !== 1 ? 'es' : ''})`,
            content: summaryResults.slice(0, 20).map(r => r.snippet).join('\n'),
            priority: 1,
        });
    }
    if (jsdocResults.length > 0) {
        sections.push({
            label: `Symbol JSDoc (${jsdocResults.length} match${jsdocResults.length !== 1 ? 'es' : ''})`,
            content: jsdocResults.slice(0, 20).map(r => r.snippet).join('\n'),
            priority: 2,
        });
    }
    const budget = TOOL_BUDGETS['search_architecture'] ?? 14000;
    const text = buildResponse(sections, budget);
    return {
        content: [{ type: 'text', text: `Search results for "${query}" (${allResults.length} total):\n\n${text}` }],
    };
}
