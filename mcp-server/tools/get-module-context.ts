import type { CallToolResult, SymbolEntry, FileSummary } from '../types.js';
import { loadIndex, loadSymbols, loadDependencies, loadSummaryCache } from './lib/data-loader.js';
import { buildResponse, type Section } from './lib/response-budget.js';

function fileInModule(filePath: string, moduleName: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith(moduleName + '/') || normalized === moduleName;
}

export function handler(
    args: { module: string },
    knowledgeRoot: string = '.knowledge',
): CallToolResult {
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        return {
            content: [{ type: 'text', text: 'Knowledge base not found. Run "npm run build-knowledge" first.' }],
            isError: true,
        };
    }

    const moduleName = args.module;
    if (!index.modules.includes(moduleName)) {
        return {
            content: [{
                type: 'text',
                text: `Module "${moduleName}" not found.\n\nAvailable modules:\n${index.modules.map(m => `  - ${m}`).join('\n')}`,
            }],
            isError: true,
        };
    }

    const cache = loadSummaryCache(knowledgeRoot);
    const symbols = loadSymbols(knowledgeRoot);
    const deps = loadDependencies(knowledgeRoot);

    // Files in this module
    const moduleFiles: string[] = [];
    const moduleSummaries: Record<string, FileSummary> = {};
    if (cache) {
        for (const [filePath, summary] of Object.entries(cache)) {
            if (fileInModule(filePath, moduleName)) {
                moduleFiles.push(filePath);
                moduleSummaries[filePath] = summary;
            }
        }
    }

    // Module symbols
    const moduleSymbols = symbols?.filter(s => fileInModule(
        s.file.replace(/\\/g, '/'),
        moduleName,
    )) ?? [];

    const exportedSymbols = moduleSymbols.filter(s => s.isExported && s.type !== 'module-init');

    // Module role from dependency graph
    let dependsOn: string[] = [];
    let dependedOnBy: string[] = [];
    if (deps) {
        dependsOn = deps.edges.filter(e => e.from === moduleName).map(e => e.to);
        dependedOnBy = deps.edges.filter(e => e.to === moduleName).map(e => e.from);
    }

    // Shared patterns: common imports
    const importCounts = new Map<string, number>();
    for (const summary of Object.values(moduleSummaries)) {
        for (const dep of summary.dependencies) {
            importCounts.set(dep, (importCounts.get(dep) ?? 0) + 1);
        }
    }
    const topImports = [...importCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Symbol type distribution
    const typeCounts: Record<string, number> = {};
    for (const s of moduleSymbols) {
        if (s.type === 'module-init') continue;
        typeCounts[s.type] = (typeCounts[s.type] ?? 0) + 1;
    }

    // Internal file dependencies
    const internalDeps: string[] = [];
    if (deps?.fileDeps) {
        for (const [file, imports] of Object.entries(deps.fileDeps)) {
            if (!fileInModule(file, moduleName)) continue;
            const moduleImports = imports.filter(imp => fileInModule(imp, moduleName));
            if (moduleImports.length > 0) {
                const shortFile = file.split('/').pop() ?? file;
                const shortImps = moduleImports.map(i => i.split('/').pop() ?? i);
                internalDeps.push(`  ${shortFile} → ${shortImps.join(', ')}`);
            }
        }
    }

    // Build sections
    const sections: Section[] = [];

    // Header + role
    const roleLines = [
        `Depends on: ${dependsOn.length > 0 ? dependsOn.join(', ') : '(none)'}`,
        `Depended on by: ${dependedOnBy.length > 0 ? dependedOnBy.join(', ') : '(none)'}`,
    ];
    sections.push({
        label: '',
        content: `=== Module: ${moduleName} (${moduleFiles.length} files) ===\n\n${roleLines.join('\n')}`,
        priority: 0,
    });

    // Files with one-line summaries
    if (moduleFiles.length > 0) {
        const fileLines = moduleFiles.map(f => {
            const purpose = moduleSummaries[f]?.purpose ?? '';
            const shortPurpose = purpose.length > 60 ? purpose.slice(0, 57) + '...' : purpose;
            const shortName = f.replace(moduleName + '/', '');
            return `  ${shortName} — ${shortPurpose}`;
        });
        sections.push({
            label: 'Files',
            content: fileLines.join('\n'),
            priority: 1,
        });
    }

    // Exported symbols
    if (exportedSymbols.length > 0) {
        const sigLines = exportedSymbols
            .slice(0, 20)
            .map(s => {
                const sig = s.signature.length > 80 ? s.signature.slice(0, 77) + '...' : s.signature;
                return `  ${s.type} ${sig}`;
            });
        if (exportedSymbols.length > 20) {
            sigLines.push(`  ... and ${exportedSymbols.length - 20} more`);
        }
        sections.push({
            label: `Exported Symbols (${exportedSymbols.length})`,
            content: sigLines.join('\n'),
            priority: 2,
        });
    }

    // Internal dependencies
    if (internalDeps.length > 0) {
        sections.push({
            label: 'Internal Dependencies',
            content: internalDeps.slice(0, 10).join('\n'),
            priority: 3,
        });
    }

    // Patterns
    const patternLines: string[] = [];
    if (topImports.length > 0) {
        patternLines.push(`  Common imports: ${topImports.map(([dep, count]) => `${dep} (${count} files)`).join(', ')}`);
    }
    const typeStr = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c} ${t}s`).join(', ');
    if (typeStr) {
        patternLines.push(`  Symbol types: ${typeStr}`);
    }
    if (patternLines.length > 0) {
        sections.push({
            label: 'Patterns',
            content: patternLines.join('\n'),
            priority: 4,
        });
    }

    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
