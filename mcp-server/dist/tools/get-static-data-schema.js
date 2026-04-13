import * as path from 'node:path';
import { loadSummaryCache } from './lib/data-loader.js';
import { buildResponse } from './lib/response-budget.js';
function isDataFile(filePath) {
    return ((filePath.includes('content/') &&
        (filePath.endsWith('-data.js') ||
            filePath.endsWith('-data.ts') ||
            filePath.includes('static-data'))) ||
        filePath.includes('ContentProvider'));
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
    const dataFiles = Object.entries(cache).filter(([filePath]) => isDataFile(filePath));
    if (dataFiles.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: 'No static data files found. The knowledge base may need rebuilding — run "npm run build-knowledge".',
                }],
        };
    }
    const sections = [
        {
            label: '',
            content: `=== Static Data Schema ===\n\n${dataFiles.length} data file(s) found.`,
            priority: 0,
        },
    ];
    for (let i = 0; i < dataFiles.length; i++) {
        const [filePath, summary] = dataFiles[i];
        const filename = path.basename(filePath);
        sections.push({
            label: filename,
            content: [
                `Path: ${filePath}`,
                `Purpose: ${summary.purpose}`,
                `Exports: ${summary.exports.length > 0 ? summary.exports.join(', ') : '(none)'}`,
                `Dependencies: ${summary.dependencies.length > 0 ? summary.dependencies.join(', ') : '(none)'}`,
            ].join('\n'),
            priority: i + 1,
        });
    }
    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
