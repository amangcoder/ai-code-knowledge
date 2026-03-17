import { loadSummaryCache } from './lib/data-loader.js';
import { buildResponse } from './lib/response-budget.js';
const VALID_PATTERN_TYPES = ['component', 'css', 'data', 'routing', 'testing'];
const PATTERN_LABELS = {
    component: 'Component Patterns',
    css: 'CSS Patterns',
    data: 'Data Patterns',
    routing: 'Routing Patterns',
    testing: 'Testing Patterns',
};
const PATTERN_PRIORITY = {
    component: 0,
    css: 1,
    data: 2,
    routing: 3,
    testing: 4,
};
function isTestFile(filePath) {
    return /\.(test|spec)\./.test(filePath);
}
function classifyFile(filePath, summary) {
    const types = [];
    const normalized = filePath.replace(/\\/g, '/');
    if (/\.(test|spec)\./.test(normalized)) {
        types.push('testing');
    }
    if (/\.(jsx|tsx)$/.test(normalized) && !isTestFile(normalized)) {
        types.push('component');
    }
    if (/\.css$/.test(normalized)) {
        types.push('css');
    }
    if (/(-data\.[jt]s$|static-data)/.test(normalized)) {
        types.push('data');
    }
    if (/route|router/.test(normalized) ||
        (summary.purpose && /routing/i.test(summary.purpose))) {
        types.push('routing');
    }
    return types;
}
function formatFileEntry(summary) {
    const lines = [];
    lines.push(`${summary.file}: ${summary.purpose}`);
    if (summary.exports && summary.exports.length > 0) {
        lines.push(`  Exports: ${summary.exports.join(', ')}`);
    }
    return lines.join('\n');
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const cache = loadSummaryCache(knowledgeRoot);
    if (cache === null) {
        return {
            content: [{
                    type: 'text',
                    text: 'Knowledge base not found. Run npm run build-knowledge first.',
                }],
            isError: true,
        };
    }
    // Validate pattern_type if provided
    const requestedTypes = args.pattern_type
        ? [args.pattern_type]
        : [...VALID_PATTERN_TYPES];
    if (args.pattern_type && !VALID_PATTERN_TYPES.includes(args.pattern_type)) {
        return {
            content: [{
                    type: 'text',
                    text: `Invalid pattern_type: "${args.pattern_type}". Valid types: ${VALID_PATTERN_TYPES.join(', ')}`,
                }],
            isError: true,
        };
    }
    // Group files by pattern type
    const grouped = {
        component: [],
        css: [],
        data: [],
        routing: [],
        testing: [],
    };
    for (const [filePath, summary] of Object.entries(cache)) {
        const types = classifyFile(filePath, summary);
        for (const type of types) {
            grouped[type].push(summary);
        }
    }
    // Build sections for requested types
    const sections = [];
    for (const type of requestedTypes) {
        const files = grouped[type];
        if (files.length === 0)
            continue;
        sections.push({
            label: PATTERN_LABELS[type],
            content: files.map(formatFileEntry).join('\n'),
            priority: PATTERN_PRIORITY[type],
        });
    }
    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
