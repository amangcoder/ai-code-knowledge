import { loadSummaryCache, loadSymbols, loadDependencies, loadIndex } from './lib/data-loader.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { toRelative, resolveProjectRoot } from './lib/path-utils.js';
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
/** Formats a file entry for pattern output with occurrence counts and example export. */
function formatFileEntry(filePath, summary, exampleSymbol) {
    const lines = [];
    const desc = summary.llmDescription ?? summary.detailedPurpose ?? summary.purpose;
    const shortDesc = desc.length > 100 ? desc.slice(0, 97) + '...' : desc;
    lines.push(`${filePath}: ${shortDesc}`);
    if (exampleSymbol) {
        const sig = exampleSymbol.signature.split('\n')[0] ?? exampleSymbol.signature;
        lines.push(`  Example: ${exampleSymbol.type} ${sig}`);
    }
    else if (summary.exports && summary.exports.length > 0) {
        lines.push(`  Exports: ${summary.exports.slice(0, 3).join(', ')}`);
    }
    return lines.join('\n');
}
/** Count structural patterns from symbols. */
function countStructuralPatterns(symbols, projectRoot) {
    const sections = [];
    const allExported = symbols.filter(s => s.isExported && s.type !== 'module-init');
    const asyncFunctions = symbols.filter(s => s.type === 'function' && s.isAsync);
    const classes = symbols.filter(s => s.type === 'class');
    const interfaces = symbols.filter(s => s.type === 'interface');
    const functions = symbols.filter(s => s.type === 'function');
    const handlers = symbols.filter(s => s.name === 'handler' || s.name.endsWith('Handler') || s.name.startsWith('handle'));
    const structLines = [
        `  Total symbols: ${symbols.length}`,
        `  Exported: ${allExported.length} (${Math.round(allExported.length / Math.max(symbols.length, 1) * 100)}%)`,
        `  Functions: ${functions.length} (${asyncFunctions.length} async)`,
        `  Classes: ${classes.length}`,
        `  Interfaces: ${interfaces.length}`,
        `  Handler pattern: ${handlers.length} handler-named symbols`,
    ];
    // Dominant code style
    if (classes.length > functions.length) {
        structLines.push(`  Dominant style: class-based (${classes.length} classes vs ${functions.length} functions)`);
    }
    else if (functions.length > 0) {
        structLines.push(`  Dominant style: functional (${functions.length} functions vs ${classes.length} classes)`);
    }
    sections.push({
        label: 'Structural Patterns (from symbol index)',
        content: structLines.join('\n'),
        priority: 0,
    });
    // Async pattern examples
    if (asyncFunctions.length > 0) {
        const examples = asyncFunctions.slice(0, 2).map(s => {
            const relFile = toRelative(s.file, projectRoot);
            const sig = s.signature.split('\n')[0] ?? s.signature;
            return `  async function ${s.name} — ${relFile}:${s.line}\n  Signature: ${sig}`;
        });
        sections.push({
            label: `Async Function Pattern (${asyncFunctions.length} occurrences)`,
            content: examples.join('\n---\n'),
            priority: 1,
        });
    }
    // Handler pattern examples
    if (handlers.length > 0) {
        const examples = handlers.slice(0, 2).map(s => {
            const relFile = toRelative(s.file, projectRoot);
            const sig = s.signature.split('\n')[0] ?? s.signature;
            return `  ${s.type} ${s.name} — ${relFile}:${s.line}\n  Signature: ${sig}`;
        });
        sections.push({
            label: `Handler Pattern (${handlers.length} occurrences)`,
            content: examples.join('\n---\n'),
            priority: 2,
        });
    }
    return sections;
}
/** Detect data access pattern from dependencies. */
function detectDataAccessPattern(knowledgeRoot) {
    const deps = loadDependencies(knowledgeRoot);
    if (!deps)
        return 'none detected';
    const allDeps = Object.values(deps.fileDeps ?? {}).flat();
    const hasPrisma = allDeps.some(d => d.toLowerCase().includes('prisma'));
    const hasMongoose = allDeps.some(d => d.toLowerCase().includes('mongoose'));
    const hasSql = allDeps.some(d => d.toLowerCase().includes('pg') || d.toLowerCase().includes('mysql'));
    const hasFs = allDeps.some(d => d === 'fs' || d === 'node:fs');
    if (hasPrisma)
        return 'Prisma ORM';
    if (hasMongoose)
        return 'Mongoose/MongoDB';
    if (hasSql)
        return 'SQL (pg/mysql)';
    if (hasFs)
        return 'filesystem (fs module)';
    return 'none detected';
}
/** Detect dominant styling mechanism from dependencies. */
function detectStyling(knowledgeRoot, cache) {
    const deps = loadDependencies(knowledgeRoot);
    if (!deps) {
        const hasCss = Object.keys(cache).some(f => f.endsWith('.css'));
        return hasCss ? 'CSS files' : 'none detected';
    }
    const allDeps = Object.values(deps.fileDeps ?? {}).flat();
    if (allDeps.some(d => d.toLowerCase().includes('tailwind')))
        return 'Tailwind CSS';
    if (allDeps.some(d => d.toLowerCase().includes('styled-components')))
        return 'styled-components';
    if (allDeps.some(d => d.toLowerCase().includes('emotion')))
        return '@emotion';
    if (allDeps.some(d => d.toLowerCase().includes('sass')))
        return 'Sass/SCSS';
    if (Object.keys(cache).some(f => f.endsWith('.css')))
        return 'CSS files';
    return 'none detected';
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const cache = loadSummaryCache(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);
    if (cache === null) {
        return {
            content: [{
                    type: 'text',
                    text: 'Knowledge base not found. The knowledge index has not been built yet.',
                }],
            isError: true,
        };
    }
    const projectRoot = resolveProjectRoot(knowledgeRoot);
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
    const symbols = loadSymbols(knowledgeRoot) ?? [];
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
            grouped[type].push({ filePath, summary });
        }
    }
    // Build sections
    const sections = [];
    // Overview section — occurrence counts + styling/data-access detection
    if (!args.pattern_type) {
        const overviewLines = [
            `Files analyzed: ${Object.keys(cache).length}`,
        ];
        for (const type of VALID_PATTERN_TYPES) {
            const count = grouped[type].length;
            overviewLines.push(`  ${type}: ${count} file${count !== 1 ? 's' : ''}`);
        }
        overviewLines.push('');
        overviewLines.push(`Dominant styling: ${detectStyling(knowledgeRoot, cache)}`);
        overviewLines.push(`Data access pattern: ${detectDataAccessPattern(knowledgeRoot)}`);
        sections.push({
            label: 'Pattern Overview',
            content: overviewLines.join('\n'),
            priority: -1,
        });
        // Structural patterns from symbols
        if (symbols.length > 0) {
            const structSections = countStructuralPatterns(symbols, projectRoot);
            sections.push(...structSections);
        }
    }
    // Per-type sections with occurrence counts and examples
    for (const type of requestedTypes) {
        const files = grouped[type];
        if (files.length === 0) {
            sections.push({
                label: `${PATTERN_LABELS[type]} (0 files)`,
                content: `  No ${type} patterns detected in the indexed files.`,
                priority: PATTERN_PRIORITY[type] + 10,
            });
            continue;
        }
        // Find an example symbol for the first file
        const firstFile = files[0];
        const exampleSym = symbols.find(s => {
            const relFile = toRelative(s.file, projectRoot);
            return (relFile === firstFile.filePath || s.file === firstFile.filePath) && s.isExported;
        });
        // Format up to 3 file examples
        const exampleLines = files.slice(0, 3).map(({ filePath, summary }) => {
            const sym = symbols.find(s => {
                const relFile = toRelative(s.file, projectRoot);
                return (relFile === filePath || s.file === filePath) && s.isExported;
            });
            return formatFileEntry(filePath, summary, sym);
        });
        if (files.length > 3) {
            exampleLines.push(`  ... and ${files.length - 3} more ${type} files`);
        }
        sections.push({
            label: `${PATTERN_LABELS[type]} (${files.length} file${files.length !== 1 ? 's' : ''})`,
            content: exampleLines.join('\n'),
            priority: PATTERN_PRIORITY[type] + 10,
        });
    }
    const budget = TOOL_BUDGETS['get_code_patterns'] ?? 14000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
