import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSymbols, loadDependencies, loadSummaryCache, loadFileToSymbols, loadIndex, loadVectorStore } from './lib/data-loader.js';
import { createEmbeddingProvider } from './lib/embedding-provider.js';
import { normalizePath, findSummary, safePath, toRelative, computeClosestMatches, resolveProjectRoot } from './lib/path-utils.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';
// Files that must never have code snippets extracted (security blocklist)
const SENSITIVE_FILE_PATTERNS = [
    /\.env($|\.)/, /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /\.crt$/, /\.cer$/,
    /secret/i, /credential/i, /\.git\//,
];
const MAX_SNIPPET_SOURCE_SIZE = 1024 * 1024; // 1 MB
const SNIPPET_LINES = 15;
function isSensitiveFile(filePath) {
    return SENSITIVE_FILE_PATTERNS.some(pat => pat.test(filePath));
}
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
/**
 * Extracts the first `lineCount` lines from a source file starting at the given line number.
 * Returns null if the file cannot be read, is sensitive, or too large.
 */
function extractCodeSnippet(absolutePath, startLine, lineCount, projectRoot) {
    // Security: validate path containment
    const safe = safePath(absolutePath, projectRoot);
    if (!safe)
        return null;
    // Security: check sensitive file patterns
    if (isSensitiveFile(absolutePath))
        return null;
    try {
        const stat = fs.statSync(absolutePath);
        if (stat.size > MAX_SNIPPET_SOURCE_SIZE)
            return null;
        const content = fs.readFileSync(absolutePath, 'utf8');
        const lines = content.split('\n');
        const start = Math.max(0, startLine - 1); // Convert 1-based to 0-based
        const snippet = lines.slice(start, start + lineCount);
        return snippet.join('\n');
    }
    catch {
        return null;
    }
}
export async function handler(args, knowledgeRoot = '.knowledge') {
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);
    const cache = loadSummaryCache(knowledgeRoot);
    if (!cache) {
        return {
            content: [{
                    type: 'text',
                    text: 'Summary cache not found. The knowledge base may need to be rebuilt.',
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
        const suggestions = computeClosestMatches(normalizedInput, Object.keys(cache), 3);
        const available = Object.keys(cache).slice(0, 10);
        const lines = [
            `No summary found for: ${args.file} (normalized: ${normalizedInput})`,
            '',
        ];
        if (suggestions.length > 0) {
            lines.push('Did you mean one of these?');
            for (const s of suggestions) {
                lines.push(`  - ${s}`);
            }
            lines.push('');
            lines.push(`Tip: Call get_implementation_context(file="${suggestions[0]}") to view it.`);
        }
        else {
            lines.push('Available (first 10):');
            lines.push(...available.map(p => `  - ${p}`));
            lines.push('');
            lines.push('Tip: Use get_batch_summaries to see all indexed files.');
        }
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
            isError: true,
        };
    }
    const summary = cache[key];
    const includePatterns = args.includePatterns !== false;
    const sections = [];
    // Base summary section
    const purposeText = summary.detailedPurpose ?? summary.llmDescription ?? summary.purpose;
    const baseLines = [
        `=== Implementation Context: ${key} ===`,
        '',
        `Purpose: ${purposeText}`,
        `Exports: ${summary.exports.length > 0 ? summary.exports.join(', ') : '(none)'}`,
        `Dependencies: ${summary.dependencies.length > 0 ? summary.dependencies.join(', ') : '(none)'}`,
    ];
    if (summary.architecturalRole) {
        baseLines.push(`Architectural Role: ${summary.architecturalRole}`);
    }
    if (summary.complexityScore != null) {
        baseLines.push(`Complexity Score: ${summary.complexityScore}`);
    }
    if (summary.sideEffects.length > 0) {
        baseLines.push(`Side Effects: ${summary.sideEffects.join(', ')}`);
    }
    if (summary.throws.length > 0) {
        baseLines.push(`Throws: ${summary.throws.join(', ')}`);
    }
    if (summary.internalPatterns && summary.internalPatterns.length > 0) {
        baseLines.push(`Internal Patterns: ${summary.internalPatterns.join(', ')}`);
    }
    // Test files — always shown
    const testFilesStr = (summary.testFiles && summary.testFiles.length > 0)
        ? summary.testFiles.join(', ')
        : 'none found';
    baseLines.push(`Test Files: ${testFilesStr}`);
    sections.push({ label: '', content: baseLines.join('\n'), priority: 0 });
    // Public API section (full signatures, no truncation)
    if (summary.publicAPI && summary.publicAPI.length > 0) {
        const apiLines = summary.publicAPI.map(entry => {
            let line = `  ${entry.type} ${entry.name}: ${entry.signature}`;
            if (entry.jsdoc) {
                line += `\n    ${entry.jsdoc}`;
            }
            return line;
        });
        sections.push({
            label: `Public API (${summary.publicAPI.length})`,
            content: apiLines.join('\n'),
            priority: 1,
        });
    }
    // Symbols — use O(1) loadFileToSymbols lookup
    const fileToSymbols = loadFileToSymbols(knowledgeRoot);
    const allSymbols = loadSymbols(knowledgeRoot);
    // Build symbolMap for caller lookups
    const symbolMap = new Map();
    if (allSymbols) {
        for (const sym of allSymbols) {
            symbolMap.set(sym.qualifiedName, sym);
        }
    }
    // Get file symbols — O(1) via fileToSymbols, fallback O(n) filter
    let fileSymbols = [];
    if (fileToSymbols) {
        fileSymbols = fileToSymbols.get(key) ?? [];
        // Fallback: match by absolute path normalization
        if (fileSymbols.length === 0 && allSymbols) {
            fileSymbols = allSymbols.filter(s => {
                const normFile = s.file.replace(/\\/g, '/');
                return normFile.endsWith('/' + key) || normFile === key;
            });
        }
    }
    else if (allSymbols) {
        fileSymbols = allSymbols.filter(s => {
            const normFile = s.file.replace(/\\/g, '/');
            return normFile.endsWith('/' + key) || normFile === key;
        });
    }
    if (fileSymbols.length > 0) {
        const filteredSymbols = fileSymbols.filter(s => s.type !== 'module-init');
        const sigLines = filteredSymbols
            .slice(0, 15)
            .map(s => {
            // Full signature — no truncation
            const parts = [`  ${s.type} ${s.signature}`];
            if (s.returnType)
                parts.push(`    Returns: ${s.returnType}`);
            // Full JSDoc
            if (s.jsdoc) {
                for (const docLine of s.jsdoc.split('\n')) {
                    parts.push(`    ${docLine}`);
                }
            }
            if (s.parameters && s.parameters.length > 0) {
                const paramStr = s.parameters.map(p => {
                    let param = `${p.name}: ${p.type}`;
                    if (p.optional)
                        param += ' (optional)';
                    if (p.defaultValue)
                        param += ` = ${p.defaultValue}`;
                    if (p.description)
                        param += ` — ${p.description}`;
                    return param;
                }).join(', ');
                parts.push(`    Params: ${paramStr}`);
            }
            // Inline caller/callee counts with top-3 callers
            const calledBy = s.calledBy ?? [];
            const calls = s.calls ?? [];
            parts.push(`    Callers: ${calledBy.length}, Callees: ${calls.length}`);
            if (calledBy.length > 0) {
                const top3 = calledBy.slice(0, 3);
                for (const callerQN of top3) {
                    const callerSym = symbolMap.get(callerQN);
                    if (callerSym) {
                        const callerRel = toRelative(callerSym.file, projectRoot);
                        parts.push(`      ← ${callerQN} (${callerRel}:${callerSym.line})`);
                    }
                    else {
                        parts.push(`      ← ${callerQN}`);
                    }
                }
                if (calledBy.length > 3) {
                    parts.push(`      ... and ${calledBy.length - 3} more callers`);
                }
            }
            if (s.complexity != null)
                parts.push(`    Complexity: ${s.complexity}`);
            return parts.join('\n');
        });
        sections.push({
            label: `Symbols (${filteredSymbols.length})`,
            content: sigLines.join('\n'),
            priority: 2,
        });
    }
    // Code snippets for exported symbols
    if (fileSymbols.length > 0) {
        const exportedSymbols = fileSymbols
            .filter(s => s.isExported && s.type !== 'module-init')
            .slice(0, 5);
        if (exportedSymbols.length > 0) {
            const snippetLines = [];
            for (const sym of exportedSymbols) {
                let absolutePath = sym.file;
                if (!path.isAbsolute(absolutePath)) {
                    absolutePath = path.join(projectRoot, absolutePath);
                }
                const snippet = extractCodeSnippet(absolutePath, sym.line, SNIPPET_LINES, projectRoot);
                if (snippet) {
                    snippetLines.push(`\`\`\`typescript`);
                    snippetLines.push(`// Code: ${sym.name} (line ${sym.line})`);
                    snippetLines.push(snippet);
                    snippetLines.push(`\`\`\``);
                }
                else {
                    snippetLines.push(`// Code snippet unavailable for: ${sym.name}`);
                }
                snippetLines.push('');
            }
            if (snippetLines.length > 0) {
                sections.push({
                    label: `Code Snippets`,
                    content: snippetLines.join('\n'),
                    priority: 2.5,
                });
            }
        }
    }
    if (includePatterns) {
        const deps = loadDependencies(knowledgeRoot);
        const relLines = [];
        if (deps?.fileDeps) {
            const imports = deps.fileDeps[key];
            if (imports && imports.length > 0) {
                relLines.push(`  Imports: ${imports.join(', ')}`);
            }
            const importedBy = [];
            for (const [file, fileDeps] of Object.entries(deps.fileDeps)) {
                if (fileDeps.includes(key))
                    importedBy.push(file);
            }
            if (importedBy.length > 0) {
                relLines.push(`  Imported by: ${importedBy.join(', ')}`);
            }
        }
        const siblings = getSiblings(key, cache);
        if (siblings.length > 0) {
            relLines.push(`  Siblings: ${siblings.join(', ')}`);
        }
        relLines.push(`  Module: ${getModule(key)}`);
        if (relLines.length > 0) {
            sections.push({
                label: 'Related Files',
                content: relLines.join('\n'),
                priority: 3,
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
        if (fileSymbols.length > 0) {
            const exported = fileSymbols.filter(s => s.isExported);
            const hasClasses = fileSymbols.some(s => s.type === 'class');
            const hasFunctions = fileSymbols.some(s => s.type === 'function');
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
                priority: 4,
            });
        }
    }
    // Similar Files (vector proximity, when VectorStore available — REQ-016)
    try {
        const vectorStore = await loadVectorStore(knowledgeRoot);
        if (vectorStore && vectorStore.isAvailable()) {
            const ep = createEmbeddingProvider();
            // Embed the current file's purpose text as the search query
            const purposeText = summary.llmDescription ?? summary.detailedPurpose ?? summary.purpose ?? '';
            if (purposeText) {
                const [queryEmbedding] = await ep.embed([purposeText]);
                // Fetch one extra result so we can exclude the file itself
                const rawResults = await vectorStore.searchFiles(queryEmbedding, 4);
                const similar = rawResults
                    .filter((r) => {
                    const resultPath = r.id.startsWith('file:')
                        ? r.id.slice('file:'.length)
                        : r.id;
                    // Exclude the current file from similar results
                    return (resultPath !== key &&
                        !(r.metadata['file'] ?? '').endsWith(key));
                })
                    .slice(0, 3);
                if (similar.length > 0) {
                    const similarLines = similar.map((r, i) => {
                        const filePath = r.id.startsWith('file:')
                            ? r.id.slice('file:'.length)
                            : r.id;
                        const purpose = r.metadata['purpose'] ?? '';
                        const scoreStr = r.score.toFixed(3);
                        const desc = purpose
                            ? ` — ${purpose.slice(0, 100)}`
                            : '';
                        return `  ${i + 1}. ${filePath} (score=${scoreStr})${desc}`;
                    });
                    sections.push({
                        label: 'Similar Files',
                        content: similarLines.join('\n'),
                        priority: 3.5,
                    });
                }
            }
        }
    }
    catch {
        // Graceful degradation — Similar Files section is optional
    }
    // Metadata footer
    if (index) {
        sections.push(buildFooterSection(index, projectRoot));
    }
    const budget = TOOL_BUDGETS['get_implementation_context'] ?? 20000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
