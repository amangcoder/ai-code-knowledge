import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileSummary, RichnessLevel, CallToolResult } from '../types.js';
import { loadIndex, loadSummaryCache } from './lib/data-loader.js';
import { buildFileTree } from './lib/file-tree.js';
import { detectTechStack, classifyProjectType } from './lib/tech-stack.js';
import { resolveProjectRoot, safePath } from './lib/path-utils.js';
import { buildResponse, type Section } from './lib/response-budget.js';
import { buildFooterSection } from './lib/metadata-footer.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.knowledge', '.git']);
const MAX_WALK_FILES = 10000;

/**
 * Recursively walks the project directory, collecting source file paths.
 * Skips symlinks, excluded directories, and caps at MAX_WALK_FILES.
 */
function walkSourceFiles(projectRoot: string): string[] {
    const results: string[] = [];

    function walk(dir: string): void {
        if (results.length >= MAX_WALK_FILES) return;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= MAX_WALK_FILES) break;
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            if (entry.isSymbolicLink()) continue;

            const fullPath = path.join(dir, entry.name);

            // Validate containment with path.sep boundary
            const safe = safePath(fullPath, projectRoot);
            if (!safe) continue;

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (SOURCE_EXTENSIONS.has(ext)) {
                    results.push(fullPath);
                }
            }
        }
    }

    walk(projectRoot);
    return results;
}

/**
 * Finds source files present on disk but not in the summary cache.
 * Reports up to 20 gaps.
 */
function findCoverageGaps(
    projectRoot: string,
    summaryCache: Record<string, FileSummary>
): string[] {
    const onDisk = walkSourceFiles(projectRoot);
    const gaps: string[] = [];

    for (const filePath of onDisk) {
        const relative = filePath
            .slice(projectRoot.length)
            .replace(/\\/g, '/')
            .replace(/^\//, '');

        const inCache = Object.keys(summaryCache).some(
            k => k === relative || k.endsWith('/' + relative) || relative.endsWith('/' + k)
        );
        if (!inCache) {
            gaps.push(relative);
            if (gaps.length >= 20) break;
        }
    }

    return gaps;
}

/**
 * Finds indexed files whose on-disk mtime is newer than the index build time.
 */
function findStaleFiles(
    projectRoot: string,
    summaryCache: Record<string, FileSummary>,
    indexTimestamp: string
): string[] {
    const indexTime = new Date(indexTimestamp).getTime();
    const stale: string[] = [];

    for (const filePath of Object.keys(summaryCache)) {
        const absolutePath = path.join(projectRoot, filePath);
        try {
            const stat = fs.statSync(absolutePath);
            if (stat.mtimeMs > indexTime) {
                stale.push(filePath);
            }
        } catch {
            // File may have been deleted
        }
    }

    return stale;
}

/**
 * Computes per-module file counts from summary cache.
 */
function computeModuleCounts(summaryCache: Record<string, FileSummary>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const filePath of Object.keys(summaryCache)) {
        const parts = filePath.split('/');
        const module = parts.length > 1 ? parts[0] : '(root)';
        counts[module] = (counts[module] ?? 0) + 1;
    }
    return counts;
}

/**
 * Computes the readiness score 0-100.
 * Deductions: 3 per gap (max -30), 2 per stale (max -20),
 * 20 if minimal richness, 10 if standard, 5 per error (max -20). Floor at 0.
 */
function computeReadinessScore(
    gaps: number,
    stale: number,
    errors: number,
    richness: RichnessLevel | undefined
): number {
    let score = 100;
    score -= Math.min(gaps * 3, 30);
    score -= Math.min(stale * 2, 20);
    if (richness === 'minimal') score -= 20;
    else if (richness === 'standard') score -= 10;
    score -= Math.min(errors * 5, 20);
    return Math.max(0, score);
}

export async function handler(
    args: { verbose?: boolean },
    knowledgeRoot: string = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge'
): Promise<CallToolResult> {
    const index = loadIndex(knowledgeRoot);

    if (!index) {
        return {
            content: [{
                type: 'text',
                text: [
                    'Knowledge base not found.',
                    '',
                    'The knowledge index has not been built yet for this project.',
                    'If you have access to the build pipeline, trigger a knowledge build.',
                    'Otherwise, use direct file reading tools (Read, Grep) to explore the codebase.',
                ].join('\n'),
            }],
        };
    }

    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const summaryCache = loadSummaryCache(knowledgeRoot) ?? {};

    // Active coverage validation
    const gaps = findCoverageGaps(projectRoot, summaryCache);
    const staleFiles = findStaleFiles(projectRoot, summaryCache, index.lastBuilt);
    const coverageErrors = index.coverageErrors ?? {};
    const errorCount = Object.keys(coverageErrors).length;
    const moduleCounts = computeModuleCounts(summaryCache);
    const readiness = computeReadinessScore(gaps.length, staleFiles.length, errorCount, index.richness);

    const sections: Section[] = [];

    // Core status (always shown)
    const coreLines = [
        `=== Knowledge Base Status ===`,
        ``,
        `Readiness Score:  ${readiness}/100`,
        `Last Built:       ${index.lastBuilt}`,
        `Richness Level:   ${index.richness ?? 'standard'}`,
        `File Count:       ${index.fileCount}`,
        `Has Symbols:      ${index.hasSymbols ? 'yes' : 'no'}`,
        `Has Dependencies: ${index.hasDependencies ? 'yes' : 'no'}`,
        ``,
        `Coverage Gaps:    ${gaps.length} file(s) not indexed`,
        `Stale Files:      ${staleFiles.length} file(s) modified after last build`,
        `Index Errors:     ${errorCount} file(s) failed during indexing`,
    ];
    sections.push({ label: '', content: coreLines.join('\n'), priority: 0 });

    // Per-module counts
    if (Object.keys(moduleCounts).length > 0) {
        const moduleLines = Object.entries(moduleCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([mod, count]) => `  ${mod}: ${count} file${count !== 1 ? 's' : ''}`);
        sections.push({
            label: 'Modules',
            content: moduleLines.join('\n'),
            priority: 1,
        });
    }

    // Coverage gaps
    if (gaps.length > 0) {
        const gapLines = gaps.map(g => `  - ${g}`);
        if (gaps.length >= 20) gapLines.push('  (showing first 20)');
        sections.push({
            label: `Coverage Gaps (${gaps.length})`,
            content: gapLines.join('\n'),
            priority: 2,
        });
    }

    // Stale files
    if (staleFiles.length > 0) {
        const staleLines = staleFiles.slice(0, 20).map(f => `  - ${f}`);
        if (staleFiles.length > 20) staleLines.push(`  ... and ${staleFiles.length - 20} more`);
        sections.push({
            label: `Stale Files (${staleFiles.length})`,
            content: staleLines.join('\n'),
            priority: 3,
        });
    }

    // Index errors
    if (errorCount > 0) {
        const errorLines = Object.entries(coverageErrors)
            .slice(0, 20)
            .map(([file, err]) => `  - ${file}: ${err}`);
        sections.push({
            label: `Index Errors (${errorCount})`,
            content: errorLines.join('\n'),
            priority: 4,
        });
    }

    // Verbose: tech stack + file tree
    if (args.verbose) {
        const techStack = detectTechStack(projectRoot);
        const projectType = classifyProjectType(projectRoot);

        const techLines = [
            `  Project Type:    ${projectType}`,
            `  Languages:       ${techStack.languages.join(', ') || '(unknown)'}`,
            `  Frameworks:      ${techStack.frameworks.join(', ') || '(none)'}`,
            `  Build Tools:     ${techStack.buildTools.join(', ') || '(none)'}`,
            `  Package Manager: ${techStack.packageManager ?? '(unknown)'}`,
        ];
        sections.push({
            label: 'Tech Stack',
            content: techLines.join('\n'),
            priority: 5,
        });

        const tree = buildFileTree(projectRoot, 2);
        if (tree) {
            sections.push({
                label: 'File Tree (depth 2)',
                content: tree,
                priority: 6,
            });
        }
    }

    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));

    return {
        content: [{ type: 'text', text: buildResponse(sections) }],
    };
}
