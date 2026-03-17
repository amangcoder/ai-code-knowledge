import { loadSymbols, loadDependencies, loadSummaryCache } from './lib/data-loader.js';
import { normalizePath, findSummary } from './lib/path-utils.js';
import { buildResponse } from './lib/response-budget.js';
function getSiblings(filePath, cache) {
    const dir = filePath.split('/').slice(0, -1).join('/');
    if (!dir)
        return [];
    return Object.keys(cache)
        .filter(k => k !== filePath && k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
        .map(k => k.split('/').pop())
        .sort();
}
function getModule(filePath) {
    const parts = filePath.split('/');
    return parts.length > 1 ? parts[0] : '(root)';
}
function classifyImports(deps) {
    const node = [];
    const external = [];
    const relative = [];
    for (const dep of deps) {
        if (dep.startsWith('node:') || dep.startsWith('fs') || dep.startsWith('path')) {
            node.push(dep);
        }
        else if (dep.startsWith('.') || dep.startsWith('/')) {
            relative.push(dep);
        }
        else {
            external.push(dep);
        }
    }
    return { node, external, relative };
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
    let normalizedInput;
    try {
        normalizedInput = normalizePath(args.file);
    }
    catch {
        return {
            content: [{ type: 'text', text: 'Invalid file path: path traversal is not allowed.' }],
            isError: true,
        };
    }
    const key = findSummary(cache, normalizedInput);
    if (!key) {
        const available = Object.keys(cache).slice(0, 10);
        return {
            content: [{
                    type: 'text',
                    text: `No summary found for: ${args.file} (normalized: ${normalizedInput})\n\nAvailable (first 10):\n${available.map(p => `  - ${p}`).join('\n')}`,
                }],
            isError: true,
        };
    }
    const summary = cache[key];
    const includePatterns = args.includePatterns !== false;
    // Base summary section
    const sections = [];
    const baseLines = [
        `=== Implementation Context: ${key} ===`,
        '',
        `Purpose: ${summary.purpose}`,
        `Exports: ${summary.exports.length > 0 ? summary.exports.join(', ') : '(none)'}`,
        `Dependencies: ${summary.dependencies.length > 0 ? summary.dependencies.join(', ') : '(none)'}`,
    ];
    if (summary.sideEffects.length > 0) {
        baseLines.push(`Side Effects: ${summary.sideEffects.join(', ')}`);
    }
    if (summary.throws.length > 0) {
        baseLines.push(`Throws: ${summary.throws.join(', ')}`);
    }
    sections.push({ label: '', content: baseLines.join('\n'), priority: 0 });
    // Symbols in this file
    const symbols = loadSymbols(knowledgeRoot);
    if (symbols) {
        const fileSymbols = symbols.filter(s => {
            const normFile = s.file.replace(/\\/g, '/');
            return normFile.endsWith('/' + key) || normFile === key;
        });
        if (fileSymbols.length > 0) {
            const sigLines = fileSymbols
                .filter(s => s.type !== 'module-init')
                .slice(0, 15)
                .map(s => {
                const sig = s.signature.length > 80 ? s.signature.slice(0, 77) + '...' : s.signature;
                return `  ${s.type} ${sig}`;
            });
            sections.push({
                label: `Symbols (${fileSymbols.filter(s => s.type !== 'module-init').length})`,
                content: sigLines.join('\n'),
                priority: 1,
            });
        }
    }
    if (includePatterns) {
        // Import/export relationships
        const deps = loadDependencies(knowledgeRoot);
        const relLines = [];
        if (deps?.fileDeps) {
            // Files this file imports
            const imports = deps.fileDeps[key];
            if (imports && imports.length > 0) {
                relLines.push(`  Imports: ${imports.join(', ')}`);
            }
            // Files that import this file
            const importedBy = [];
            for (const [file, fileDeps] of Object.entries(deps.fileDeps)) {
                if (fileDeps.includes(key)) {
                    importedBy.push(file);
                }
            }
            if (importedBy.length > 0) {
                relLines.push(`  Imported by: ${importedBy.join(', ')}`);
            }
        }
        // Siblings
        const siblings = getSiblings(key, cache);
        if (siblings.length > 0) {
            relLines.push(`  Siblings: ${siblings.join(', ')}`);
        }
        relLines.push(`  Module: ${getModule(key)}`);
        if (relLines.length > 0) {
            sections.push({
                label: 'Related Files',
                content: relLines.join('\n'),
                priority: 2,
            });
        }
        // Pattern fingerprint
        const importClasses = classifyImports(summary.dependencies);
        const patternLines = [];
        const importStyles = [];
        if (importClasses.node.length > 0)
            importStyles.push('node builtins');
        if (importClasses.external.length > 0)
            importStyles.push('external packages');
        if (importClasses.relative.length > 0)
            importStyles.push('relative imports');
        if (importStyles.length > 0) {
            patternLines.push(`  Import style: ${importStyles.join(' + ')}`);
        }
        // Determine export style from symbols
        if (symbols) {
            const fileSyms = symbols.filter(s => {
                const normFile = s.file.replace(/\\/g, '/');
                return normFile.endsWith('/' + key) || normFile === key;
            });
            const exported = fileSyms.filter(s => s.isExported);
            const hasClasses = fileSyms.some(s => s.type === 'class');
            const hasFunctions = fileSyms.some(s => s.type === 'function');
            if (exported.length > 0) {
                patternLines.push(`  Export style: ${exported.length} named export(s)`);
            }
            if (hasClasses && hasFunctions) {
                patternLines.push(`  Code style: mixed classes and functions`);
            }
            else if (hasClasses) {
                patternLines.push(`  Code style: class-based`);
            }
            else if (hasFunctions) {
                patternLines.push(`  Code style: functional`);
            }
        }
        if (patternLines.length > 0) {
            sections.push({
                label: 'Patterns',
                content: patternLines.join('\n'),
                priority: 3,
            });
        }
    }
    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
