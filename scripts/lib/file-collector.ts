import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AdapterRegistry } from './adapters/adapter-registry.js';
import type { FileContext } from './adapters/language-adapter.js';

/**
 * Walks the project directory and collects source files grouped by language.
 * Uses the adapter registry to determine which files belong to which language
 * and which directories to ignore.
 *
 * @param excludeDirs  Additional folder names or relative paths to skip (e.g. ["vendor", "src/generated"])
 */
export function collectSourceFiles(
    projectRoot: string,
    registry: AdapterRegistry,
    excludeDirs?: string[]
): Map<string, FileContext[]> {
    const ignoreDirNames = new Set(registry.getIgnorePatterns());
    // Normalise extra excludes: split into bare names vs relative paths
    const excludeNames = new Set<string>();
    const excludeRelPaths = new Set<string>();
    for (const e of (excludeDirs ?? [])) {
        if (e.includes('/') || e.includes(path.sep)) {
            excludeRelPaths.add(e.split(path.sep).join('/'));
        } else {
            excludeNames.add(e);
        }
    }
    const grouped = new Map<string, FileContext[]>();

    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const relPath = path.relative(projectRoot, fullPath).split(path.sep).join('/');
                const skip = ignoreDirNames.has(entry.name)
                    || excludeNames.has(entry.name)
                    || excludeRelPaths.has(relPath)
                    || entry.name.startsWith('.');
                if (!skip) {
                    walk(fullPath);
                }
            } else if (entry.isFile()) {
                const adapter = registry.getForFile(entry.name);
                if (!adapter) continue;

                const content = fs.readFileSync(fullPath, 'utf-8');
                const relativePath = path.relative(projectRoot, fullPath).split(path.sep).join('/');

                const ctx: FileContext = {
                    filePath: fullPath,
                    relativePath,
                    content,
                    projectRoot,
                };

                let list = grouped.get(adapter.language);
                if (!list) {
                    list = [];
                    grouped.set(adapter.language, list);
                }
                list.push(ctx);
            }
        }
    }

    walk(projectRoot);
    return grouped;
}
