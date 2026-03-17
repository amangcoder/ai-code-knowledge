import { DependencyGraph } from '../../src/types.js';
import { groupFilesByModule, type ModuleConfig } from './module-grouper.js';
import { ImportInfo } from './dependency-extractor.js';
import * as path from 'node:path';

/**
 * Builds a module-level dependency graph with cycle detection.
 * @param fileDeps Map of absolute file path -> array of ImportInfo objects.
 * @param projectRoot Absolute path to project root.
 */
export function buildDependencyGraph(fileDeps: Record<string, ImportInfo[]>, projectRoot: string, moduleConfig?: ModuleConfig): DependencyGraph {
    const allFiles = Object.keys(fileDeps);
    const moduleMap = groupFilesByModule(allFiles, projectRoot, moduleConfig);
    const nodes = Object.keys(moduleMap);

    // Reverse lookup: relative file path -> module name
    const fileToModule = new Map<string, string>();
    for (const [moduleName, files] of Object.entries(moduleMap)) {
        for (const file of files) {
            fileToModule.set(file, moduleName);
        }
    }

    const edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }> = [];
    const edgeMap = new Map<string, Map<string, 'direct' | 'dynamic'>>();

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
                let targets = edgeMap.get(fromModule);
                if (!targets) {
                    targets = new Map<string, 'direct' | 'dynamic'>();
                    edgeMap.set(fromModule, targets);
                }
                const currentType = targets.get(toModule);
                const newType: 'direct' | 'dynamic' = dep.isDynamic ? 'dynamic' : 'direct';

                if (!currentType) {
                    targets.set(toModule, newType);
                } else if (currentType === 'dynamic' && newType === 'direct') {
                    // Update to direct if we find a non-dynamic import
                    targets.set(toModule, 'direct');
                }
            }
        }
    }

    // Convert edgeMap to edges array
    for (const [from, targets] of edgeMap.entries()) {
        for (const [to, type] of targets.entries()) {
            edges.push({ from, to, type });
        }
    }

    // Cycle detection using Tarjan's SCC algorithm
    const findCycles = (nodes: string[], edges: Array<{ from: string; to: string }>): string[][] => {
        const adj = new Map<string, string[]>();
        nodes.forEach(n => adj.set(n, []));
        edges.forEach(e => adj.get(e.from)?.push(e.to));

        let index = 0;
        const stack: string[] = [];
        const onStack = new Set<string>();
        const indices = new Map<string, number>();
        const lowlinks = new Map<string, number>();
        const sccs: string[][] = [];

        const strongconnect = (v: string) => {
            indices.set(v, index);
            lowlinks.set(v, index);
            index++;
            stack.push(v);
            onStack.add(v);

            for (const w of adj.get(v) || []) {
                if (!indices.has(w)) {
                    strongconnect(w);
                    lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
                } else if (onStack.has(w)) {
                    lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
                }
            }

            if (lowlinks.get(v) === indices.get(v)) {
                const scc: string[] = [];
                let w: string;
                do {
                    w = stack.pop()!;
                    onStack.delete(w);
                    scc.push(w);
                } while (w !== v);
                if (scc.length > 1) {
                    sccs.push(scc);
                }
            }
        };

        for (const v of nodes) {
            if (!indices.has(v)) strongconnect(v);
        }
        return sccs;
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
