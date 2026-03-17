import { loadSymbols, loadIndex } from './lib/data-loader.js';
import { buildResponse } from './lib/response-budget.js';
import { toRelative, computeClosestMatches, resolveProjectRoot } from './lib/path-utils.js';
import { buildFooterSection } from './lib/metadata-footer.js';
const MAX_RESULTS = 200;
/**
 * Performs BFS traversal over the inverted call graph (calledBy) starting
 * from the target symbol, collecting all reachable callers up to `maxDepth`
 * levels. Tracks visited symbols to prevent infinite loops on circular calls.
 */
function bfsCallers(targetQualifiedName, symbolMap, maxDepth) {
    const results = [];
    const visited = new Set();
    visited.add(targetQualifiedName);
    const queue = [[targetQualifiedName, 0]];
    while (queue.length > 0 && results.length < MAX_RESULTS) {
        const [current, currentDepth] = queue.shift();
        if (currentDepth >= maxDepth)
            continue;
        const symbol = symbolMap.get(current);
        if (!symbol)
            continue;
        for (const callerName of (symbol.calledBy ?? [])) {
            if (!visited.has(callerName)) {
                visited.add(callerName);
                const callerSymbol = symbolMap.get(callerName);
                results.push({
                    qualifiedName: callerName,
                    file: callerSymbol?.file ?? 'unknown',
                    line: callerSymbol?.line ?? 0,
                    depth: currentDepth + 1,
                });
                queue.push([callerName, currentDepth + 1]);
            }
        }
    }
    return results;
}
/**
 * Performs BFS traversal over the forward call graph (calls) starting
 * from the target symbol, collecting all reachable callees up to `maxDepth`.
 */
function bfsCallees(targetQualifiedName, symbolMap, maxDepth) {
    const results = [];
    const visited = new Set();
    visited.add(targetQualifiedName);
    const queue = [[targetQualifiedName, 0]];
    while (queue.length > 0 && results.length < MAX_RESULTS) {
        const [current, currentDepth] = queue.shift();
        if (currentDepth >= maxDepth)
            continue;
        const symbol = symbolMap.get(current);
        if (!symbol)
            continue;
        for (const calleeName of (symbol.calls ?? [])) {
            if (!visited.has(calleeName)) {
                visited.add(calleeName);
                const calleeSymbol = symbolMap.get(calleeName);
                results.push({
                    qualifiedName: calleeName,
                    file: calleeSymbol?.file ?? 'unknown',
                    line: calleeSymbol?.line ?? 0,
                    depth: currentDepth + 1,
                });
                queue.push([calleeName, currentDepth + 1]);
            }
        }
    }
    return results;
}
/**
 * Disambiguates a symbol name against the full symbol list.
 * Accepts 'relativePath::symbolName' format for unambiguous selection.
 * Returns all matches.
 */
function disambiguate(symbolInput, symbols, projectRoot) {
    // Check for file-qualified format: 'relativePath::symbolName'
    const sepIdx = symbolInput.indexOf('::');
    if (sepIdx !== -1) {
        const filePart = symbolInput.slice(0, sepIdx).toLowerCase();
        const namePart = symbolInput.slice(sepIdx + 2).toLowerCase();
        return symbols.filter(s => {
            const relFile = toRelative(s.file, projectRoot).toLowerCase();
            return relFile === filePart && s.name.toLowerCase() === namePart;
        });
    }
    // Try exact qualifiedName match (case-insensitive)
    const inputLower = symbolInput.toLowerCase();
    const exactMatches = symbols.filter(s => s.qualifiedName.toLowerCase() === inputLower);
    if (exactMatches.length > 0)
        return exactMatches;
    // Try simple name match
    return symbols.filter(s => s.name.toLowerCase() === inputLower);
}
/**
 * Handler for the find_callers MCP tool.
 * Returns all callers (or callees) of a symbol with file/line info.
 * Supports BFS traversal, disambiguation for ambiguous names, and
 * file-qualified format (relativePath::symbolName).
 */
export function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    const { symbol, maxDepth = 1, direction = 'callers' } = args;
    const effectiveMaxDepth = Math.min(maxDepth, 10);
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
    const symbols = loadSymbols(knowledgeRoot);
    if (symbols === null) {
        return {
            content: [{
                    type: 'text',
                    text: 'Symbol index not available. The knowledge base may need to be rebuilt.',
                }],
            isError: true,
        };
    }
    // Build lookup map by qualifiedName
    const symbolMap = new Map();
    for (const sym of symbols) {
        symbolMap.set(sym.qualifiedName, sym);
    }
    // Disambiguate the input symbol
    const matches = disambiguate(symbol, symbols, projectRoot);
    if (matches.length === 0) {
        // Provide closest matches as suggestions
        const allNames = [...new Set(symbols.map(s => s.name))];
        const suggestions = computeClosestMatches(symbol, allNames, 3);
        const lines = [
            `Symbol "${symbol}" not found in the knowledge index.`,
            '',
            `Tip: Use find_symbol(name="${symbol}") to search by partial name.`,
            `     Or use the format "relativePath::symbolName" (e.g., "tools/find-callers.ts::handler").`,
        ];
        if (suggestions.length > 0) {
            lines.push('');
            lines.push('Closest matches:');
            for (const s of suggestions) {
                lines.push(`  - ${s}`);
            }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    if (matches.length > 1) {
        // Disambiguation required — return all matches
        const lines = [
            `"${symbol}" matches ${matches.length} symbols. Specify one using "relativePath::symbolName" format:`,
            '',
        ];
        for (const m of matches) {
            const relFile = toRelative(m.file, projectRoot);
            lines.push(`  ${relFile}::${m.name} (${m.type}, line ${m.line})`);
        }
        lines.push('');
        lines.push(`Example: find_callers(symbol="${toRelative(matches[0].file, projectRoot)}::${matches[0].name}")`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    const targetSymbol = matches[0];
    // Perform BFS traversal
    const traversalResults = direction === 'callees'
        ? bfsCallees(targetSymbol.qualifiedName, symbolMap, effectiveMaxDepth)
        : bfsCallers(targetSymbol.qualifiedName, symbolMap, effectiveMaxDepth);
    const targetRelFile = toRelative(targetSymbol.file, projectRoot);
    if (traversalResults.length === 0) {
        const dirLabel = direction === 'callees' ? 'callees' : 'callers';
        const sections = [
            {
                label: '',
                content: `No ${dirLabel} found for "${targetRelFile}::${targetSymbol.name}" (maxDepth: ${effectiveMaxDepth}).`,
                priority: 0,
            },
            buildFooterSection(index, projectRoot),
        ];
        return { content: [{ type: 'text', text: buildResponse(sections) }] };
    }
    // Format output
    const dirLabel = direction === 'callees' ? 'Callees' : 'Callers';
    const lines = [
        `${dirLabel} of "${targetRelFile}::${targetSymbol.name}" (maxDepth: ${effectiveMaxDepth}):`,
        '',
    ];
    for (const result of traversalResults) {
        const indent = '  '.repeat(result.depth);
        const relFile = result.file !== 'unknown'
            ? toRelative(result.file, projectRoot)
            : 'unknown';
        const location = relFile !== 'unknown' ? ` — ${relFile}:${result.line}` : '';
        lines.push(`${indent}${result.qualifiedName}${location}`);
    }
    if (traversalResults.length >= MAX_RESULTS) {
        lines.push('');
        lines.push(`[Results capped at ${MAX_RESULTS}. Use a smaller maxDepth or more specific symbol name.]`);
    }
    const sections = [
        { label: '', content: lines.join('\n'), priority: 0 },
        buildFooterSection(index, projectRoot),
    ];
    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
