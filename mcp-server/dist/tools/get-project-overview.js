import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIndex, loadSymbols } from './lib/data-loader.js';
import { buildFileTree } from './lib/file-tree.js';
import { detectTechStack, classifyProjectType } from './lib/tech-stack.js';
import { resolveProjectRoot } from './lib/path-utils.js';
import { buildResponse } from './lib/response-budget.js';
function getProjectName(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.name ?? path.basename(projectRoot);
    }
    catch {
        return path.basename(projectRoot);
    }
}
function getMainEntry(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.main ?? null;
    }
    catch {
        return null;
    }
}
function computeSymbolCounts(symbols) {
    const counts = {};
    for (const s of symbols) {
        counts[s.type] = (counts[s.type] ?? 0) + 1;
    }
    return counts;
}
function findEntryPoints(symbols, mainEntry) {
    // Top symbols by calledBy count
    const withCallers = symbols
        .filter(s => s.calledBy.length > 0 && s.type !== 'module-init')
        .sort((a, b) => b.calledBy.length - a.calledBy.length)
        .slice(0, 5);
    const entries = [];
    if (mainEntry) {
        entries.push(`${mainEntry} (main)`);
    }
    for (const s of withCallers) {
        const relFile = s.file.split('/').slice(-2).join('/');
        entries.push(`${s.qualifiedName} — ${relFile} (${s.calledBy.length} callers)`);
    }
    return entries;
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        return {
            content: [{
                    type: 'text',
                    text: 'Knowledge base not found. Run "npm run build-knowledge" first.',
                }],
            isError: true,
        };
    }
    const depth = args.depth ?? 2;
    const projectName = getProjectName(projectRoot);
    const projectType = classifyProjectType(projectRoot);
    const techStack = detectTechStack(projectRoot);
    const mainEntry = getMainEntry(projectRoot);
    const symbols = loadSymbols(knowledgeRoot);
    const symbolCounts = symbols ? computeSymbolCounts(symbols) : {};
    const totalSymbols = symbols?.length ?? 0;
    const entryPoints = symbols ? findEntryPoints(symbols, mainEntry) : [];
    // Build summary sentence
    const langStr = techStack.languages.join(', ') || 'Unknown';
    const summary = `A ${projectType} with ${index.modules.length} modules and ${index.fileCount} source files. ` +
        `Built with ${langStr}${techStack.frameworks.length > 0 ? ' using ' + techStack.frameworks.join(', ') : ''}.`;
    const sections = [
        {
            label: '',
            content: [
                `=== Project Overview: ${projectName} ===`,
                '',
                summary,
            ].join('\n'),
            priority: 0,
        },
        {
            label: 'Tech Stack',
            content: [
                `  Languages: ${techStack.languages.join(', ') || '(unknown)'}`,
                `  Frameworks: ${techStack.frameworks.join(', ') || '(none)'}`,
                `  Build Tools: ${techStack.buildTools.join(', ') || '(none)'}`,
                `  Package Manager: ${techStack.packageManager ?? '(unknown)'}`,
                `  Project Type: ${projectType}`,
            ].join('\n'),
            priority: 1,
        },
        {
            label: 'Stats',
            content: [
                `  Modules: ${index.modules.join(', ')}`,
                `  Files: ${index.fileCount} | Symbols: ${totalSymbols} | Last Built: ${index.lastBuilt}`,
            ].join('\n'),
            priority: 2,
        },
    ];
    // Symbol counts
    const countEntries = Object.entries(symbolCounts)
        .filter(([type]) => type !== 'module-init')
        .sort((a, b) => b[1] - a[1]);
    if (countEntries.length > 0) {
        sections.push({
            label: 'Symbol Counts',
            content: '  ' + countEntries.map(([type, count]) => `${type}: ${count}`).join(', '),
            priority: 3,
        });
    }
    // Entry points
    if (entryPoints.length > 0) {
        sections.push({
            label: 'Key Entry Points',
            content: entryPoints.map(e => `  - ${e}`).join('\n'),
            priority: 4,
        });
    }
    // File tree
    const tree = buildFileTree(projectRoot, depth);
    if (tree) {
        sections.push({
            label: `File Tree (depth ${depth})`,
            content: tree,
            priority: 5,
        });
    }
    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
