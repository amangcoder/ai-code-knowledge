import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOrLoad } from './cache.js';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.knowledge', '.git']);
const STAT_BATCH_SIZE = 50;
/**
 * Returns a human-readable age string for an ISO timestamp.
 * e.g. '< 1 minute ago', '5 minutes ago', '2 hours ago', '3 days ago'
 */
export function formatAge(isoTimestamp) {
    const now = Date.now();
    const then = new Date(isoTimestamp).getTime();
    if (isNaN(then))
        return 'unknown age';
    const diffMs = now - then;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSeconds < 60)
        return '< 1 minute ago';
    if (diffMinutes < 60)
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    if (diffHours < 24)
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}
/** Recursively walks a directory and collects source files (non-symlinks). */
function collectSourceFiles(dir) {
    const results = [];
    function walk(current) {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (EXCLUDED_DIRS.has(entry.name))
                continue;
            if (entry.isSymbolicLink())
                continue; // skip symlinks
            if (entry.isDirectory()) {
                walk(path.join(current, entry.name));
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (SOURCE_EXTENSIONS.includes(ext)) {
                    results.push(path.join(current, entry.name));
                }
            }
        }
    }
    walk(dir);
    return results;
}
/**
 * Determines if any source file in projectRoot has been modified after
 * the index build time. Uses InProcessCache with 60-second TTL.
 *
 * @param index       The knowledge index
 * @param projectRoot Absolute project root path
 */
export function computeStaleness(index, projectRoot) {
    const indexTime = new Date(index.lastBuilt).getTime();
    if (isNaN(indexTime))
        return false;
    // Cache key with 60-second rolling TTL
    const bucketKey = `staleness:${index.lastBuilt}:${Math.floor(Date.now() / 60000)}`;
    const cached = getOrLoad(bucketKey, () => {
        const sourceFiles = collectSourceFiles(projectRoot);
        // Batch fs.stat calls in groups of STAT_BATCH_SIZE (sync here for simplicity)
        // We batch to limit simultaneous file handles conceptually, though sync doesn't
        // actually hold them open concurrently. This mirrors the design intent.
        let isStale = false;
        for (let i = 0; i < sourceFiles.length && !isStale; i += STAT_BATCH_SIZE) {
            const batch = sourceFiles.slice(i, i + STAT_BATCH_SIZE);
            for (const file of batch) {
                try {
                    const stat = fs.statSync(file);
                    if (stat.mtimeMs > indexTime) {
                        isStale = true;
                        break;
                    }
                }
                catch {
                    // ignore stat errors
                }
            }
        }
        return isStale;
    }, bucketKey // Use bucketKey as timestamp — it changes every 60 seconds naturally
    );
    return cached ?? false;
}
/**
 * Builds a standardized metadata footer string.
 *
 * @param index       The knowledge index
 * @param projectRoot Absolute project root path
 */
export function buildFooter(index, projectRoot) {
    const age = formatAge(index.lastBuilt);
    const richness = index.richness ?? 'standard';
    const fileCount = index.fileCount;
    const isStale = computeStaleness(index, projectRoot);
    const stalenessFlag = isStale
        ? 'STALE — source files modified after last build'
        : 'fresh';
    return [
        '---',
        `Index: built ${age} (${index.lastBuilt}) | Richness: ${richness} | Files indexed: ${fileCount} | Staleness: ${stalenessFlag}`,
    ].join('\n');
}
/**
 * Returns a Section suitable for appending to any tool handler's sections array.
 * Priority 99 ensures it appears last and is first to be dropped under tight budgets.
 *
 * @param index       The knowledge index
 * @param projectRoot Absolute project root path
 */
export function buildFooterSection(index, projectRoot) {
    return {
        label: '',
        content: buildFooter(index, projectRoot),
        priority: 99,
    };
}
