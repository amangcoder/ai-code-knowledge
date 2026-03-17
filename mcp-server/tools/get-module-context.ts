import type { CallToolResult, SymbolEntry, FileSummary } from '../types.js';
import { loadIndex, loadSymbols, loadDependencies, loadSummaryCache } from './lib/data-loader.js';
import { buildResponse, TOOL_BUDGETS, type Section } from './lib/response-budget.js';
import { resolveProjectRoot, computeClosestMatches } from './lib/path-utils.js';
import { buildFooterSection } from './lib/metadata-footer.js';

function fileInModule(filePath: string, moduleName: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith(moduleName + '/') || normalized === moduleName;
}

/** Infers architectural role label from file path when not explicitly set. */
function inferArchitecturalRole(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const filename = normalized.split('/').pop() ?? '';

    if (filename === 'server.ts' || filename === 'index.ts' || filename === 'main.ts') {
        return 'entry-point';
    }
    if (normalized.includes('/lib/')) {
        return 'utility';
    }
    if (
        filename.startsWith('get-') ||
        filename.startsWith('find-') ||
        filename.startsWith('search-') ||
        filename.startsWith('health-') ||
        filename.startsWith('validate-')
    ) {
        return 'handler';
    }
    return 'module';
}

export function handler(
    args: { module: string },
    knowledgeRoot: string = '.knowledge',
): CallToolResult {
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

    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const moduleName = args.module;

    if (!index.modules.includes(moduleName)) {
        const suggestions = computeClosestMatches(moduleName, index.modules, 3);
        const lines = [
            `Module "${moduleName}" not found.`,
            '',
            `Available modules:`,
            ...index.modules.map(m => `  - ${m}`),
        ];
        if (suggestions.length > 0) {
            lines.push('');
            lines.push(`Did you mean: ${suggestions.join(', ')}?`);
        }
        lines.push('');
        lines.push(`Tip: Use get_project_overview() to see all modules.`);
        lines.push(`Format example: get_module_context(module="${index.modules[0] ?? 'tools'}")`);
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
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
    const moduleSymbols: SymbolEntry[] = symbols?.filter(s => fileInModule(
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

    // Files with architectural role prefix labels and 150-char descriptions
    if (moduleFiles.length > 0) {
        const fileLines = moduleFiles.map(f => {
            const s = moduleSummaries[f];
            const purpose = s?.llmDescription ?? s?.detailedPurpose ?? s?.purpose ?? '';
            // Up to 150 chars (previously 60)
            const shortPurpose = purpose.length > 150 ? purpose.slice(0, 147) + '...' : purpose;
            const shortName = f.replace(moduleName + '/', '');
            const role = s?.architecturalRole ?? inferArchitecturalRole(f);
            return `  [${role}] ${shortName} — ${shortPurpose}`;
        });
        sections.push({
            label: 'Files',
            content: fileLines.join('\n'),
            priority: 1,
        });
    }

    // Architectural role distribution
    const roleCounts: Record<string, number> = {};
    for (const [filePath, s] of Object.entries(moduleSummaries)) {
        const role = s.architecturalRole ?? inferArchitecturalRole(filePath);
        roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    if (Object.keys(roleCounts).length > 0) {
        const roleStr = Object.entries(roleCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([role, count]) => `${count} ${role}${count > 1 ? 's' : ''}`)
            .join(', ');
        sections.push({
            label: 'Architectural Roles',
            content: `  ${roleStr}`,
            priority: 2,
        });
    }

    // Exported symbols — full signatures with return type and first JSDoc line; no 80-char truncation
    if (exportedSymbols.length > 0) {
        const sigLines = exportedSymbols
            .slice(0, 20)
            .map(s => {
                // Full signature — no truncation
                const parts = [`  ${s.type} ${s.signature}`];
                if (s.returnType) parts.push(`    Returns: ${s.returnType}`);
                // First line of JSDoc (strip comment markers)
                if (s.jsdoc) {
                    const firstDocLine = s.jsdoc
                        .replace(/^\/\*\*\s*/, '')
                        .split('\n')
                        .map(l => l.replace(/^\s*\*\s?/, '').trim())
                        .find(l => l.length > 0);
                    if (firstDocLine) parts.push(`    // ${firstDocLine}`);
                }
                return parts.join('\n');
            });
        if (exportedSymbols.length > 20) {
            sigLines.push(
                `  ... and ${exportedSymbols.length - 20} more — use get_implementation_context(file="<path>") for full detail`
            );
        }
        sections.push({
            label: `Exported Symbols (${exportedSymbols.length})`,
            content: sigLines.join('\n'),
            priority: 3,
        });
    }

    // Internal dependencies
    if (internalDeps.length > 0) {
        sections.push({
            label: 'Internal Dependencies',
            content: internalDeps.slice(0, 10).join('\n'),
            priority: 4,
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
            priority: 5,
        });
    }

    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));

    const budget = TOOL_BUDGETS['get_module_context'] ?? 14000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
