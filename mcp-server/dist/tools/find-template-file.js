import * as path from 'node:path';
import { loadSummaryCache } from './lib/data-loader.js';
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
export function handler(args, knowledgeRoot = '.knowledge') {
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
    const tokens = tokenize(args.description);
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
    const top = scored.slice(0, 3);
    if (top.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No matching files found. Try different keywords.',
                },
            ],
        };
    }
    const lines = [];
    lines.push(`=== Template Suggestions for: "${args.description}" ===`);
    lines.push('');
    for (const match of top) {
        lines.push(`File: ${match.summary.file}`);
        lines.push(`Purpose: ${match.summary.purpose}`);
        if (match.summary.exports && match.summary.exports.length > 0) {
            lines.push(`Exports: ${match.summary.exports.join(', ')}`);
        }
        else {
            lines.push('Exports: (none)');
        }
        lines.push(`Score: ${match.score}`);
        lines.push('');
    }
    return {
        content: [
            {
                type: 'text',
                text: lines.join('\n'),
            },
        ],
    };
}
