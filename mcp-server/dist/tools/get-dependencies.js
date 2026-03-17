import { loadDependencies as loadDepsFromCache } from './lib/data-loader.js';
import { computeClosestMatches } from './lib/path-utils.js';
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
    const graph = loadDepsFromCache(knowledgeRoot);
    if (graph === null) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'Dependency graph not found. The knowledge index has not been built yet for this project.',
                },
            ],
            isError: true,
        };
    }
    // Check if the requested module exists in the nodes list
    if (!graph.nodes.includes(moduleName)) {
        const sorted = graph.nodes.slice().sort();
        const suggestions = computeClosestMatches(moduleName, sorted, 3);
        const lines = [
            `Module "${moduleName}" not found in the dependency graph.`,
            '',
        ];
        if (suggestions.length > 0) {
            lines.push('Did you mean one of these?');
            for (const s of suggestions) {
                lines.push(`  - ${s}`);
            }
            lines.push('');
        }
        if (sorted.length > 0) {
            lines.push('Available modules:');
            for (const m of sorted) {
                lines.push(`  - ${m}`);
            }
        }
        else {
            lines.push('No modules are currently indexed.');
        }
        lines.push('');
        lines.push(`Tip: Use get_project_overview() to see all modules, or get_module_context(module="<name>") to explore a specific one.`);
        lines.push(`Format example: get_dependencies(module="${sorted[0] ?? 'tools'}")`);
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
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
