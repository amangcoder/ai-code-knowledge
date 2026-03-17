import * as path from 'node:path';
export function normalizePath(filePath) {
    let normalized = path.normalize(filePath).split(path.sep).join('/');
    normalized = normalized.replace(/^\.\//, '');
    normalized = normalized.replace(/^\/+/, '');
    if (normalized.split('/').includes('..')) {
        throw new Error('Path traversal not allowed');
    }
    if (!path.extname(normalized)) {
        normalized = normalized + '.ts';
    }
    return normalized;
}
export function resolveProjectRoot(knowledgeRoot) {
    // .knowledge is typically at <projectRoot>/.knowledge
    const resolved = path.resolve(knowledgeRoot);
    return path.dirname(resolved);
}
export function findSummary(cache, normalizedInput) {
    if (cache[normalizedInput])
        return normalizedInput;
    const keys = Object.keys(cache);
    return keys.find((key) => key === normalizedInput || key.endsWith('/' + normalizedInput)) ?? null;
}
