import * as path from 'node:path';

/**
 * Normalizes a file path to a relative path using forward slashes.
 * Ensures consistent cache keys across platforms.
 */
export function normalizeFilePath(filePath: string, projectRoot: string): string {
    const rel = path.relative(projectRoot, path.resolve(filePath));
    return rel.split(path.sep).join('/');
}
