import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIndex, loadSymbols, loadDependencies, loadSummaryCache } from './lib/data-loader.js';
import { buildFileTree } from './lib/file-tree.js';
import { detectTechStack, classifyProjectType } from './lib/tech-stack.js';
import { resolveProjectRoot, toRelative } from './lib/path-utils.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';
const SOURCE_EXTENSIONS = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
    '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby',
    '.cs': 'C#', '.cpp': 'C++', '.c': 'C',
    '.swift': 'Swift', '.php': 'PHP',
};
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
function findEntryPoints(symbols, mainEntry, projectRoot) {
    const withCallers = symbols
        .filter(s => (s.calledBy ?? []).length > 0 && s.type !== 'module-init')
        .sort((a, b) => (b.calledBy ?? []).length - (a.calledBy ?? []).length)
        .slice(0, 5);
    const entries = [];
    if (mainEntry) {
        entries.push(`${mainEntry} (main)`);
    }
    for (const s of withCallers) {
        const relFile = toRelative(s.file, projectRoot);
        entries.push(`${s.qualifiedName} — ${relFile} (${(s.calledBy ?? []).length} callers)`);
    }
    return entries;
}
/** File-extension based language detection fallback. */
function detectLanguagesFromExtensions(projectRoot) {
    const found = new Set();
    const excludedDirs = new Set(['node_modules', 'dist', '.knowledge', '.git', '.next', 'coverage']);
    function walk(dir, depth) {
        if (depth > 3)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (excludedDirs.has(entry.name))
                continue;
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), depth + 1);
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                const lang = SOURCE_EXTENSIONS[ext];
                if (lang)
                    found.add(lang);
            }
        }
    }
    walk(projectRoot, 0);
    return [...found];
}
/** Builds module dependency table from the dependency graph. */
function buildModuleDependencyTable(graph, modules, symbols) {
    const lines = [];
    for (const mod of modules) {
        const modSymbols = symbols.filter(s => s.file.replace(/\\/g, '/').startsWith(mod + '/') ||
            s.file.replace(/\\/g, '/') === mod);
        const exportedCount = modSymbols.filter(s => s.isExported && s.type !== 'module-init').length;
        const deps = graph.edges.filter(e => e.from === mod).map(e => e.to);
        const dependents = graph.edges.filter(e => e.to === mod).map(e => e.from);
        const depsStr = deps.length > 0 ? deps.join(', ') : 'none';
        const dependentsStr = dependents.length > 0 ? dependents.join(', ') : 'none';
        lines.push(`  ${mod}: ${exportedCount} exported symbols | deps: ${depsStr} | used by: ${dependentsStr}`);
    }
    return lines;
}
export function handler(args, knowledgeRoot = '.knowledge') {
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        return {
            content: [{
                    type: 'text',
                    text: 'Knowledge base not found. The knowledge index has not been built yet for this project.',
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
    const deps = loadDependencies(knowledgeRoot);
    const summaryCache = loadSummaryCache(knowledgeRoot);
    const symbolCounts = symbols ? computeSymbolCounts(symbols) : {};
    const totalSymbols = symbols?.length ?? 0;
    const entryPoints = symbols ? findEntryPoints(symbols, mainEntry, projectRoot) : [];
    // Language fallback via file extensions
    let languages = techStack.languages;
    if (languages.length === 0) {
        languages = detectLanguagesFromExtensions(projectRoot);
    }
    const langStr = languages.join(', ') || 'Unknown';
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
                `  Languages: ${languages.join(', ') || '(unknown)'}`,
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
    // Module dependency table
    if (deps && symbols && index.modules.length > 0) {
        const tableLines = buildModuleDependencyTable(deps, index.modules, symbols);
        sections.push({
            label: 'Module Dependencies',
            content: tableLines.join('\n'),
            priority: 5,
        });
        // Circular dependencies
        if (deps.cycles && deps.cycles.length > 0) {
            const cycleLines = deps.cycles.map(cycle => `  Circular: ${cycle.join(' → ')}`);
            sections.push({
                label: `Circular Dependencies (${deps.cycles.length})`,
                content: cycleLines.join('\n'),
                priority: 6,
            });
        }
    }
    // Per-file descriptions from summary cache
    if (summaryCache) {
        const fileDescLines = [];
        for (const [filePath, fileSummary] of Object.entries(summaryCache)) {
            const desc = fileSummary.llmDescription ?? fileSummary.detailedPurpose ?? fileSummary.purpose;
            if (desc) {
                const shortDesc = desc.length > 100 ? desc.slice(0, 97) + '...' : desc;
                fileDescLines.push(`  ${filePath} — ${shortDesc}`);
            }
        }
        if (fileDescLines.length > 0) {
            sections.push({
                label: 'File Purposes',
                content: fileDescLines.join('\n'),
                priority: 7,
            });
        }
    }
    // File tree
    const tree = buildFileTree(projectRoot, depth);
    if (tree) {
        sections.push({
            label: `File Tree (depth ${depth})`,
            content: tree,
            priority: 8,
        });
    }
    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));
    const budget = TOOL_BUDGETS['get_project_overview'] ?? 16000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
