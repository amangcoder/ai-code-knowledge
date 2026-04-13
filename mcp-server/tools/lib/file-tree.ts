import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_IGNORE = new Set([
    'node_modules', '.git', '.knowledge', 'dist', '__pycache__',
    '.venv', '.next', '.turbo', 'coverage', '.nyc_output',
]);

export function buildFileTree(
    rootDir: string,
    maxDepth: number = 2,
    ignoreDirs?: Set<string>,
): string {
    const ignore = ignoreDirs ?? DEFAULT_IGNORE;
    const lines: string[] = [];

    function walk(dir: string, prefix: string, depth: number): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
            if (entry.name.startsWith('.') && ignore.has(entry.name)) continue;
            if (ignore.has(entry.name)) continue;

            if (entry.isDirectory()) {
                if (depth >= maxDepth) {
                    lines.push(`${prefix}${entry.name}/`);
                } else {
                    lines.push(`${prefix}${entry.name}/`);
                    walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
                }
            } else {
                lines.push(`${prefix}${entry.name}`);
            }
        }
    }

    walk(rootDir, '  ', 1);
    return lines.join('\n');
}
