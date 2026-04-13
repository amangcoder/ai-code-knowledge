import * as fs from 'node:fs';
import * as path from 'node:path';
export function normalizePath(filePath) {
    let normalized = path.normalize(filePath).split(path.sep).join('/');
    normalized = normalized.replace(/^\.\//, '');
    normalized = normalized.replace(/^\/+/, '');
    if (normalized.split('/').includes('..')) {
        throw new Error('Path traversal not allowed');
    }
    // Don't auto-append .ts here — findSummary will try extensions
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
    const direct = keys.find((key) => key === normalizedInput || key.endsWith('/' + normalizedInput));
    if (direct)
        return direct;
    // Try common extensions when exact and suffix match both fail
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
        const withExt = normalizedInput + ext;
        if (cache[withExt])
            return withExt;
        const suffixMatch = keys.find((key) => key === withExt || key.endsWith('/' + withExt));
        if (suffixMatch)
            return suffixMatch;
    }
    return null;
}
/**
 * Converts an absolute path to a project-relative path.
 * Returns '(external)' if the path does not start with projectRoot.
 *
 * @param absolutePath Absolute file path (may be Windows or POSIX)
 * @param projectRoot  Absolute project root path
 */
export function toRelative(absolutePath, projectRoot) {
    // Normalize separators to forward slashes
    const normAbsolute = absolutePath.replace(/\\/g, '/');
    let normRoot = projectRoot.replace(/\\/g, '/');
    // Remove trailing slash from root
    normRoot = normRoot.replace(/\/+$/, '');
    if (!normAbsolute.startsWith(normRoot + '/') && normAbsolute !== normRoot) {
        // Path does not start with projectRoot — never return '../' paths
        return '(external)';
    }
    const relative = normAbsolute.slice(normRoot.length + 1);
    return relative || '.';
}
/**
 * Resolves a user-provided path against projectRoot and verifies containment.
 * Uses realpathSync to resolve symlinks before checking.
 * Returns the resolved absolute path if safe, null if it escapes the project boundary.
 *
 * @param userInput   Relative or absolute path provided by user/tool
 * @param projectRoot Absolute project root path
 */
export function safePath(userInput, projectRoot) {
    const resolved = path.resolve(projectRoot, userInput);
    const normalizedRoot = path.resolve(projectRoot);
    // Must be exactly projectRoot or start with projectRoot + sep
    const isContained = resolved === normalizedRoot ||
        resolved.startsWith(normalizedRoot + path.sep);
    if (!isContained) {
        return null;
    }
    // Resolve symlinks to prevent symlink-escape attacks
    try {
        const realResolved = fs.realpathSync(resolved);
        const realRoot = fs.realpathSync(normalizedRoot);
        const realContained = realResolved === realRoot ||
            realResolved.startsWith(realRoot + path.sep);
        return realContained ? resolved : null;
    }
    catch {
        // ENOENT or other errors — fall back to string-prefix check
        // (safe for non-existent paths that haven't been created yet)
        return isContained ? resolved : null;
    }
}
/**
 * Returns the top-N candidates from `candidates` with the highest substring
 * overlap to `query`. Uses trigram scoring (shared 3-char substrings),
 * normalized by max(query.length, candidate.length).
 *
 * No external edit-distance library — pure string operations.
 *
 * @param query      The search query
 * @param candidates Pool of candidate strings to rank
 * @param topN       Number of top results to return (default: 3)
 */
export function computeClosestMatches(query, candidates, topN = 3) {
    if (candidates.length === 0 || query.length === 0)
        return [];
    const queryLower = query.toLowerCase();
    function score(candidate) {
        const candLower = candidate.toLowerCase();
        const maxLen = Math.max(queryLower.length, candLower.length);
        if (maxLen === 0)
            return 0;
        // Exact or contains match gets high score
        if (candLower === queryLower)
            return 1.0;
        if (candLower.includes(queryLower) || queryLower.includes(candLower)) {
            return 0.8 + Math.min(queryLower.length, candLower.length) / maxLen * 0.2;
        }
        // Count shared trigrams
        const queryTrigrams = new Set();
        for (let i = 0; i <= queryLower.length - 3; i++) {
            queryTrigrams.add(queryLower.slice(i, i + 3));
        }
        let shared = 0;
        for (let i = 0; i <= candLower.length - 3; i++) {
            const tri = candLower.slice(i, i + 3);
            if (queryTrigrams.has(tri))
                shared++;
        }
        return shared / maxLen;
    }
    return candidates
        .map(c => ({ candidate: c, score: score(c) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .filter(x => x.score > 0)
        .map(x => x.candidate);
}
