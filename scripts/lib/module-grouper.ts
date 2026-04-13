import * as path from 'node:path';

import type { RichnessLevel } from '../../src/types.js';

export interface ModuleConfig {
    moduleRoots?: string[];
    richness?: RichnessLevel;
    exclude?: string[];  // folder names or relative paths to skip during indexing
}

/**
 * Resolves a relative file path to a module name.
 * Strategy:
 * 1. If moduleRoots is configured, match against roots and use the matched path.
 * 2. Otherwise, use the first directory segment of the relative path.
 * 3. For root-level files (no directory), fall back to the project dir name.
 */
function resolveModuleName(relativePath: string, projectRoot: string, config?: ModuleConfig): string {
    const parts = relativePath.split('/');

    if (config?.moduleRoots?.length) {
        for (const root of config.moduleRoots) {
            const rootParts = root.split('/');
            let matches = true;
            let matchLen = 0;

            for (let i = 0; i < rootParts.length; i++) {
                if (i >= parts.length) { matches = false; break; }
                if (rootParts[i] === '*') {
                    matchLen = i + 1;
                    continue;
                }
                if (rootParts[i] !== parts[i]) { matches = false; break; }
                matchLen = i + 1;
            }

            if (matches && matchLen <= parts.length) {
                return parts.slice(0, matchLen).join('/');
            }
        }
    }

    // Default: use first directory segment, or project dir name for root-level files
    if (parts.length <= 1) {
        return path.basename(projectRoot);
    }
    return parts[0];
}

/**
 * Groups files by their parent module directory.
 * @param filePaths List of absolute file paths.
 * @param projectRoot Absolute path to the project root.
 * @param config Optional module configuration for custom module roots.
 * @returns A mapping from module name to an array of relative file paths.
 */
export function groupFilesByModule(filePaths: string[], projectRoot: string, config?: ModuleConfig): Record<string, string[]> {
    const modules: Record<string, string[]> = {};

    for (const filePath of filePaths) {
        const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');
        const moduleName = resolveModuleName(relativePath, projectRoot, config);

        if (!modules[moduleName]) {
            modules[moduleName] = [];
        }
        modules[moduleName].push(relativePath);
    }

    return modules;
}
