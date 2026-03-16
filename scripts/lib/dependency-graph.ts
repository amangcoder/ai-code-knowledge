import { DependencyGraph } from '../../src/types.js';
import { groupFilesByModule } from './module-grouper.js';
import { ImportInfo } from './dependency-extractor.js';
import * as path from 'node:path';

/**
 * Builds a module-level dependency graph with cycle detection.
 * @param fileDeps Map of absolute file path -> array of ImportInfo objects.
 * @param projectRoot Absolute path to project root.
 */
export function buildDependencyGraph(fileDeps: Record<string, ImportInfo[]>, projectRoot: string): DependencyGraph {
    const allFiles = Object.keys(fileDeps);
    const moduleMap = groupFilesByModule(allFiles, projectRoot);
    const nodes = Object.keys(moduleMap);

    // Reverse lookup: relative file path -> module name
    const fileToModule = new Map<string, string>();
    for (const [moduleName, files] of Object.entries(moduleMap)) {
        for (const file of files) {
            fileToModule.set(file, moduleName);
        }
    }

    const edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }> = [];
    const edgeSet = new Map<string, 'direct' | 'dynamic'>();

    // Build module-level edges
    for (const [filePath, dependencies] of Object.entries(fileDeps)) {
        const relativeFilePath = path.relative(projectRoot, filePath);
        const fromModule = fileToModule.get(relativeFilePath);
        if (!fromModule) continue;

        for (const dep of dependencies) {
            const relativeDepPath = path.relative(projectRoot, dep.path);
            const toModule = fileToModule.get(relativeDepPath);

            // Add edge if it's cross-module and not self-looping
            if (toModule && fromModule !== toModule) {
                const edgeKey = `${fromModule}->${toModule}`;
                const currentType = edgeSet.get(edgeKey);
                const newType: 'direct' | 'dynamic' = dep.isDynamic ? 'dynamic' : 'direct';

                if (!currentType) {
                    edgeSet.set(edgeKey, newType);
                } else if (currentType === 'dynamic' && newType === 'direct') {
                    // Update to direct if we find a non-dynamic import
                    edgeSet.set(edgeKey, 'direct');
                }
            }
        }
    }

    // Convert edgeSet back to edges array
    for (const [key, type] of edgeSet.entries()) {
        const [from, to] = key.split('->');
        edges.push({ from, to, type });
    }

    // Cycle detection using DFS
    const findCycles = (nodes: string[], edges: Array<{ from: string; to: string }>): string[][] => {
        const cycles: string[][] = [];
        const adj = new Map<string, string[]>();
        nodes.forEach(n => adj.set(n, []));
        edges.forEach(e => adj.get(e.from)?.push(e.to));

        const visited = new Set<string>();
        const stack = new Set<string>();
        const pathStack: string[] = [];

        const dfs = (u: string) => {
            visited.add(u);
            stack.add(u);
            pathStack.push(u);

            for (const v of adj.get(u) || []) {
                if (stack.has(v)) {
                    // Cycle detected: extract the cycle from pathStack
                    const cycleStart = pathStack.indexOf(v);
                    cycles.push(pathStack.slice(cycleStart));
                } else if (!visited.has(v)) {
                    dfs(v);
                }
            }

            stack.delete(u);
            pathStack.pop();
        };

        for (const node of nodes) {
            if (!visited.has(node)) {
                dfs(node);
            }
        }

        return cycles;
    };

    const cycles = findCycles(nodes, edges);

    // Make fileDeps paths relative
    const relativeFileDeps: Record<string, string[]> = {};
    for (const [f, deps] of Object.entries(fileDeps)) {
        relativeFileDeps[path.relative(projectRoot, f)] = deps.map(d => path.relative(projectRoot, d.path));
    }

    return {
        nodes,
        edges,
        cycles,
        fileDeps: relativeFileDeps
    };
}
