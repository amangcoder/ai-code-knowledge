import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * Loads dependencies.json from the knowledge root directory.
 * Returns null if the file does not exist.
 */
function loadDependencies(knowledgeRoot) {
    const depsPath = path.join(knowledgeRoot, 'dependencies.json');
    if (!fs.existsSync(depsPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(depsPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Performs BFS traversal over the dependency graph starting from the given
 * module, collecting all reachable dependencies up to `maxDepth` levels.
 * Tracks visited nodes to prevent infinite loops on cyclic graphs.
 */
function bfsTraverse(startModule, edges, maxDepth) {
    // Build adjacency map: module -> [{to, type}]
    const adj = new Map();
    for (const edge of edges) {
        if (!adj.has(edge.from)) {
            adj.set(edge.from, []);
        }
        adj.get(edge.from).push({ to: edge.to, type: edge.type });
    }
    const results = [];
    const visited = new Set();
    visited.add(startModule);
    // Queue entries: [moduleName, depth]
    const queue = [[startModule, 0]];
    while (queue.length > 0) {
        const [current, currentDepth] = queue.shift();
        if (currentDepth >= maxDepth) {
            continue;
        }
        const neighbors = adj.get(current) ?? [];
        for (const { to, type } of neighbors) {
            if (!visited.has(to)) {
                visited.add(to);
                results.push({ from: current, to, type, depth: currentDepth + 1 });
                queue.push([to, currentDepth + 1]);
            }
        }
    }
    return results;
}
/**
 * Handler for the get_dependencies MCP tool.
 * Returns direct or transitive module dependencies from .knowledge/dependencies.json.
 * Lists available modules when the requested module is not found.
 */
export function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    const { module: moduleName, depth = 1 } = args;
    const graph = loadDependencies(knowledgeRoot);
    if (graph === null) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'dependencies.json not found. Please run "npm run build-knowledge" to generate the knowledge artifacts.',
                },
            ],
            isError: true,
        };
    }
    // Check if the requested module exists in the nodes list
    if (!graph.nodes.includes(moduleName)) {
        const sorted = graph.nodes.slice().sort();
        const availableMsg = sorted.length > 0
            ? `Available modules:\n  ${sorted.join('\n  ')}`
            : 'No modules are currently indexed.';
        return {
            content: [
                {
                    type: 'text',
                    text: `Module "${moduleName}" not found in the dependency graph.\n\n${availableMsg}`,
                },
            ],
        };
    }
    // Perform BFS to collect dependencies
    const results = bfsTraverse(moduleName, graph.edges, depth);
    if (results.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Module "${moduleName}" has no dependencies (depth: ${depth}).`,
                },
            ],
        };
    }
    // Format output
    const lines = [
        `Dependencies for "${moduleName}" (depth: ${depth}):\n`,
    ];
    for (const result of results) {
        const indent = '  '.repeat(result.depth);
        const typeLabel = result.type === 'dynamic' ? ' [dynamic]' : '';
        lines.push(`${indent}${result.to}${typeLabel}`);
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
