import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * Loads symbols.json from the knowledge root directory.
 * Returns null if the file does not exist.
 */
function loadSymbols(knowledgeRoot) {
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    if (!fs.existsSync(symbolsPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(symbolsPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Performs BFS traversal over the inverted call graph (calledBy) starting
 * from the target symbol, collecting all reachable callers up to `maxDepth`
 * levels. Tracks visited symbols to prevent infinite loops on circular calls.
 */
function bfsCallers(targetQualifiedName, symbolMap, maxDepth) {
    const results = [];
    const visited = new Set();
    visited.add(targetQualifiedName);
    // Queue entries: [qualifiedName, depth]
    const queue = [[targetQualifiedName, 0]];
    while (queue.length > 0) {
        const [current, currentDepth] = queue.shift();
        if (currentDepth >= maxDepth) {
            continue;
        }
        const symbol = symbolMap.get(current);
        if (!symbol) {
            continue;
        }
        for (const callerName of symbol.calledBy) {
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
 * Handler for the find_callers MCP tool.
 * Returns all callers of a symbol from the calledBy index with file/line info.
 * Supports BFS traversal up to maxDepth levels for transitive callers.
 */
export function handler(args, knowledgeRoot) {
    const { symbol, maxDepth = 1 } = args;
    const symbols = loadSymbols(knowledgeRoot);
    if (symbols === null) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'symbols.json not found. Please run "npm run build-knowledge" to generate the knowledge artifacts.',
                },
            ],
            isError: true,
        };
    }
    // Build a lookup map by qualifiedName for fast access
    const symbolMap = new Map();
    for (const sym of symbols) {
        symbolMap.set(sym.qualifiedName, sym);
    }
    // Find the target symbol by qualifiedName (case-insensitive)
    const targetLower = symbol.toLowerCase();
    const targetSymbol = symbols.find((s) => s.qualifiedName.toLowerCase() === targetLower);
    if (!targetSymbol) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Symbol "${symbol}" not found. Use the find_symbol tool to search for available symbols.`,
                },
            ],
        };
    }
    // Perform BFS traversal to collect callers
    const callers = bfsCallers(targetSymbol.qualifiedName, symbolMap, maxDepth);
    if (callers.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `No callers found for "${targetSymbol.qualifiedName}" (maxDepth: ${maxDepth}).`,
                },
            ],
        };
    }
    // Format output
    const lines = [
        `Callers of "${targetSymbol.qualifiedName}" (maxDepth: ${maxDepth}):\n`,
    ];
    for (const caller of callers) {
        const indent = '  '.repeat(caller.depth);
        const location = caller.file !== 'unknown' ? ` — ${caller.file}:${caller.line}` : '';
        lines.push(`${indent}${caller.qualifiedName}${location}`);
    }
    return {
        content: [
            {
                type: 'text',
                text: lines.join('\n'),
            },
        ],
    };
}
