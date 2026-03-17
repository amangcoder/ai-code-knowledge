import type { CallToolResult, FileSummary, SymbolEntry } from '../types.js';
import { loadSummaryCache, loadFileToSymbols, loadIndex } from './lib/data-loader.js';
import { normalizePath, findSummary, toRelative, resolveProjectRoot } from './lib/path-utils.js';
import { buildResponse, TOOL_BUDGETS, type Section } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';

/**
 * Formats a rich multi-line entry for a single file summary.
 */
function formatRich(
    displayPath: string,
    summary: FileSummary,
    fileSymbols: SymbolEntry[],
): string {
    const lines: string[] = [];

    // File path
    lines.push(`File: ${displayPath}`);

    // Description — up to 150 chars
    const desc = summary.llmDescription ?? summary.detailedPurpose ?? summary.purpose;
    const shortDesc = desc.length > 150 ? desc.slice(0, 147) + '...' : desc;
    lines.push(`Description: ${shortDesc}`);

    // Richness level
    const richness = summary.llmDescription ? 'rich' : (summary.detailedPurpose ? 'standard' : 'minimal');
    lines.push(`Richness: ${richness}`);

    // Architectural role
    if (summary.architecturalRole) {
        lines.push(`Role: [${summary.architecturalRole}]`);
    }

    // Up to 10 exported symbol names
    const exportedSymbols = fileSymbols.filter(s => s.isExported && s.type !== 'module-init');
    if (exportedSymbols.length > 0) {
        const names = exportedSymbols.slice(0, 10).map(s => s.name);
        lines.push(`Exports: ${names.join(', ')}${exportedSymbols.length > 10 ? ` (+${exportedSymbols.length - 10} more)` : ''}`);
    } else if (summary.exports.length > 0) {
        lines.push(`Exports: ${summary.exports.slice(0, 10).join(', ')}`);
    }

    // Total symbol count
    lines.push(`Symbol count: ${fileSymbols.length}`);

    return lines.join('\n');
}

export function handler(
    args: { files: string[] },
    knowledgeRoot: string = '.knowledge',
): CallToolResult {
    const cache = loadSummaryCache(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);

    if (!cache) {
        return {
            content: [{
                type: 'text',
                text: 'Summary cache not found. The knowledge index has not been built yet.',
            }],
            isError: true,
        };
    }

    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const fileToSymbols = loadFileToSymbols(knowledgeRoot);

    const foundEntries: Array<{ path: string; text: string }> = [];
    const notFound: string[] = [];

    for (const file of args.files) {
        let normalized: string;
        try {
            normalized = normalizePath(file);
        } catch {
            notFound.push(file);
            continue;
        }

        const key = findSummary(cache, normalized);
        if (key) {
            const summary = cache[key];
            const relPath = toRelative(key, projectRoot);
            const displayPath = relPath !== '(external)' ? relPath : key;

            // Get symbols for this file via O(1) map
            const fileSyms = fileToSymbols?.get(key) ??
                fileToSymbols?.get(displayPath) ?? [];

            foundEntries.push({
                path: displayPath,
                text: formatRich(displayPath, summary, fileSyms),
            });
        } else {
            notFound.push(file);
        }
    }

    const sections: Section[] = [];

    // Header
    sections.push({
        label: '',
        content: `=== Batch Summaries (${foundEntries.length} of ${args.files.length} found) ===`,
        priority: 0,
    });

    // Each file as its own section with '---' separators
    for (let i = 0; i < foundEntries.length; i++) {
        sections.push({
            label: '',
            content: (i > 0 ? '---\n' : '') + foundEntries[i].text,
            priority: 1 + Math.floor(i / 5),
        });
    }

    // Not found
    if (notFound.length > 0) {
        sections.push({
            label: 'Not Found',
            content: notFound.map(f => `  - ${f}`).join('\n'),
            priority: 90,
        });
    }

    // Metadata footer
    if (index) {
        sections.push(buildFooterSection(index, projectRoot));
    }

    const budget = TOOL_BUDGETS['get_batch_summaries'] ?? 14000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
