import { loadSummaryCache } from './lib/data-loader.js';
import { normalizePath, findSummary } from './lib/path-utils.js';
function formatCompact(summary) {
    const parts = [summary.purpose];
    if (summary.exports.length > 0) {
        parts.push(`Exports: ${summary.exports.join(', ')}`);
    }
    if (summary.dependencies.length > 0) {
        parts.push(`Deps: ${summary.dependencies.join(', ')}`);
    }
    return parts.join('. ');
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const cache = loadSummaryCache(knowledgeRoot);
    if (!cache) {
        return {
            content: [{
                    type: 'text',
                    text: 'Summary cache not found. Run "npm run build-knowledge" first.',
                }],
            isError: true,
        };
    }
    const found = [];
    const notFound = [];
    for (const file of args.files) {
        let normalized;
        try {
            normalized = normalizePath(file);
        }
        catch {
            notFound.push(file);
            continue;
        }
        const key = findSummary(cache, normalized);
        if (key) {
            found.push(`[${key}] ${formatCompact(cache[key])}`);
        }
        else {
            notFound.push(file);
        }
    }
    const lines = [
        `=== Batch Summaries (${found.length} of ${args.files.length} found) ===`,
        '',
    ];
    lines.push(...found);
    if (notFound.length > 0) {
        lines.push('');
        lines.push(`Not found: ${notFound.join(', ')}`);
    }
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
    };
}
