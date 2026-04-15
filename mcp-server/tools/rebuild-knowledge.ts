import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { CallToolResult } from '../types.js';
import { resolveProjectRoot } from './lib/path-utils.js';
import { invalidate } from './lib/cache.js';

/**
 * Absolute path to the AICoder package root (two levels up from
 * mcp-server/dist/tools/ where this file compiles to).
 * Used to locate scripts/build-knowledge.ts regardless of which
 * project the MCP server is serving.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Maximum combined stdout+stderr buffer size (64 KB). */
const MAX_LOG_BYTES = 65_536;

/** Default timeout in minutes. */
const DEFAULT_TIMEOUT_MINUTES = 10;

/** Valid richness levels for the --richness CLI flag. */
const VALID_RICHNESS = ['minimal', 'standard', 'rich'] as const;

export interface RebuildKnowledgeArgs {
    incremental?: boolean;       // default true
    skip_vectors?: boolean;
    skip_features?: boolean;
    skip_graphify?: boolean;
    rebuild_features?: boolean;
    richness?: 'minimal' | 'standard' | 'rich';
    timeout_minutes?: number;    // range 1-30, default 10
}

/**
 * Checks whether a build is already in progress by reading index.json
 * directly from disk (bypasses the LRU cache which has a 30s TTL).
 */
function checkConcurrency(knowledgeRoot: string): { inProgress: boolean; buildGeneration?: number } {
    const indexPath = path.join(knowledgeRoot, 'index.json');
    try {
        const raw = fs.readFileSync(indexPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
            inProgress: !!data.buildInProgress,
            buildGeneration: data.buildGeneration,
        };
    } catch {
        // index.json doesn't exist or is unparseable — no build in progress
        return { inProgress: false };
    }
}

/**
 * Maps handler args to CLI flags for scripts/build-knowledge.ts.
 * projectRoot is passed as --root so the script indexes the correct project
 * even when cwd is set to the AICoder package root.
 */
function buildCliArgs(args: RebuildKnowledgeArgs, projectRoot: string): string[] {
    const cliArgs: string[] = ['--root', projectRoot];

    // incremental defaults to true — pass --incremental unless explicitly false
    if (args.incremental !== false) {
        cliArgs.push('--incremental');
    }

    if (args.skip_vectors) {
        cliArgs.push('--skip-vectors');
    }
    if (args.skip_features) {
        cliArgs.push('--skip-features');
    }
    if (args.skip_graphify) {
        cliArgs.push('--skip-graphify');
    }
    if (args.rebuild_features) {
        cliArgs.push('--rebuild-features');
    }

    if (args.richness && VALID_RICHNESS.includes(args.richness)) {
        cliArgs.push('--richness', args.richness);
    }

    return cliArgs;
}

/**
 * Extracts build stats from log output using regex patterns matching
 * the [build-knowledge] log lines emitted by scripts/build-knowledge.ts.
 */
function extractStats(log: string): Record<string, number | string> {
    const stats: Record<string, number | string> = {};

    // Symbols: 1234 in 567ms
    const symbolsMatch = log.match(/Symbols:\s*(\d+)\s+in\s+(\d+)ms/);
    if (symbolsMatch) {
        stats.symbols = Number(symbolsMatch[1]);
        stats.symbols_duration_ms = Number(symbolsMatch[2]);
    }

    // Dependencies: 12 modules, 3 cycles in 45ms
    const depsMatch = log.match(/Dependencies:\s*(\d+)\s+modules?,\s*(\d+)\s+cycles?\s+in\s+(\d+)ms/);
    if (depsMatch) {
        stats.dep_modules = Number(depsMatch[1]);
        stats.dep_cycles = Number(depsMatch[2]);
        stats.deps_duration_ms = Number(depsMatch[3]);
    }

    // Summaries: 50 generated (10 cached) in 123ms
    const summaryMatch = log.match(/Summaries:\s*(\d+)\s+generated\s*\((\d+)\s+cached\)\s+in\s+(\d+)ms/);
    if (summaryMatch) {
        stats.summaries_generated = Number(summaryMatch[1]);
        stats.summaries_cached = Number(summaryMatch[2]);
        stats.summaries_duration_ms = Number(summaryMatch[3]);
    }

    // Embeddings: 100 files, 200 symbols in 456ms
    const embMatch = log.match(/Embeddings:\s*(\d+)\s+files?,\s*(\d+)\s+symbols?\s+in\s+(\d+)ms/);
    if (embMatch) {
        stats.embeddings_files = Number(embMatch[1]);
        stats.embeddings_symbols = Number(embMatch[2]);
        stats.embeddings_duration_ms = Number(embMatch[3]);
    }

    // Graph: 500 nodes, 1000 edges in 78ms
    const graphMatch = log.match(/Graph:\s*(\d+)\s+nodes?,\s*(\d+)\s+edges?\s+in\s+(\d+)ms/);
    if (graphMatch) {
        stats.graph_nodes = Number(graphMatch[1]);
        stats.graph_edges = Number(graphMatch[2]);
        stats.graph_duration_ms = Number(graphMatch[3]);
    }

    // Graphify: +10 nodes, +20 edges in 34ms
    const graphifyMatch = log.match(/Graphify:\s*\+(\d+)\s+nodes?,\s*\+(\d+)\s+edges?\s+in\s+(\d+)ms/);
    if (graphifyMatch) {
        stats.graphify_nodes_added = Number(graphifyMatch[1]);
        stats.graphify_edges_added = Number(graphifyMatch[2]);
        stats.graphify_duration_ms = Number(graphifyMatch[3]);
    }

    // Features: 5 discovered in 89ms
    const featureMatch = log.match(/Features:\s*(\d+)\s+discovered\s+in\s+(\d+)ms/);
    if (featureMatch) {
        stats.features_discovered = Number(featureMatch[1]);
        stats.features_duration_ms = Number(featureMatch[2]);
    }

    // Found N <lang> files
    const fileMatches = log.matchAll(/Found\s+(\d+)\s+(\w+)\s+files/g);
    for (const m of fileMatches) {
        stats[`${m[2]}_files`] = Number(m[1]);
    }

    // Done in 12345ms total
    const doneMatch = log.match(/Done\s+in\s+(\d+)ms\s+total/);
    if (doneMatch) {
        stats.build_total_ms = Number(doneMatch[1]);
    }

    return stats;
}

/**
 * MCP tool handler for rebuild_knowledge.
 * Spawns build-knowledge.ts as a child process with the given parameters.
 *
 * Follows the handler signature pattern from health-check.ts.
 */
export async function handler(
    args: RebuildKnowledgeArgs,
    knowledgeRoot: string = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge',
): Promise<CallToolResult> {
    const startTime = Date.now();

    // ── Concurrency guard ─────────────────────────────────────────────────────
    const concurrency = checkConcurrency(knowledgeRoot);
    if (concurrency.inProgress) {
        return {
            content: [{ type: 'text', text: 'A build is already in progress' }],
            isError: true,
        };
    }

    // ── Resolve paths and build CLI args ───────────────────────────────────────
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const cliArgs = buildCliArgs(args, projectRoot);

    // ── Timeout configuration ─────────────────────────────────────────────────
    const timeoutMinutes = Math.max(1, Math.min(30, args.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES));
    const timeoutMs = timeoutMinutes * 60 * 1000;

    // ── Spawn the build process ───────────────────────────────────────────────
    return new Promise<CallToolResult>((resolve) => {
        // Run from the AICoder package root so that the script's relative imports
        // (./lib/...) resolve correctly. projectRoot is passed via --root.
        const scriptPath = path.join(PACKAGE_ROOT, 'scripts', 'build-knowledge.ts');
        const child = spawn('npx', ['tsx', scriptPath, ...cliArgs], {
            cwd: PACKAGE_ROOT,
            env: process.env,
        });

        let stdout = '';
        let stderr = '';
        let truncated = false;
        let timedOut = false;

        function trimBuffers(): void {
            // NOTE: combined is measured in character counts (UTF-16 code units),
            // not byte counts. For the ASCII-only build logs this produces in
            // practice, character count equals byte count. MAX_LOG_BYTES is used
            // as the cap; rename it MAX_LOG_CHARS if precise byte semantics matter.
            const combined = stdout.length + stderr.length;
            if (combined > MAX_LOG_BYTES) {
                truncated = true;
                // Keep the tail: trim the oldest data from both buffers proportionally.
                // stderr is prioritized over stdout; stdout is trimmed first to
                // preserve stderr diagnostic output.
                const excess = combined - MAX_LOG_BYTES;
                if (stdout.length >= excess) {
                    stdout = stdout.slice(excess);
                } else {
                    const remaining = excess - stdout.length;
                    stdout = '';
                    stderr = stderr.slice(remaining);
                }
            }
        }

        child.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
            trimBuffers();
        });
        child.stdout.on('error', () => { /* swallow EPIPE */ });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
            trimBuffers();
        });
        child.stderr.on('error', () => { /* swallow EPIPE */ });

        // ── Timeout handler ───────────────────────────────────────────────────
        // sigkillTimer is set inside the SIGTERM handler and cleared on exit.
        let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            // Follow-up SIGKILL after a 5-second grace period in case the process
            // tree (npx → tsx → node) ignores SIGTERM and the 'close' event never
            // fires — which would otherwise hang the MCP connection indefinitely.
            sigkillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        }, timeoutMs);

        child.on('close', (exitCode: number | null) => {
            clearTimeout(timer);
            clearTimeout(sigkillTimer);

            const durationMs = Date.now() - startTime;
            const combinedLog = stderr + '\n' + stdout;

            // ── Always invalidate cache ───────────────────────────────────────
            invalidate();

            // ── Extract stats from log output ─────────────────────────────────
            const stats = extractStats(combinedLog);

            // ── Determine status ──────────────────────────────────────────────
            let status: 'success' | 'failure' | 'timeout';
            if (timedOut) {
                status = 'timeout';
            } else if (exitCode !== 0) {
                status = 'failure';
            } else {
                status = 'success';
            }

            // ── Build response text ───────────────────────────────────────────
            const lines: string[] = [
                `## Knowledge Base Rebuild: ${status.toUpperCase()}`,
                '',
                `**Status:** ${status}`,
                `**Duration:** ${durationMs}ms`,
                `**Exit code:** ${exitCode ?? 'N/A'}`,
                `**Timed out:** ${timedOut}`,
                `**Truncated:** ${truncated}`,
            ];

            if (Object.keys(stats).length > 0) {
                lines.push('', '### Build Stats');
                for (const [key, value] of Object.entries(stats)) {
                    lines.push(`- **${key}:** ${value}`);
                }
            }

            // Include the log output (tail-truncated)
            const logSnippet = combinedLog.trim();
            if (logSnippet) {
                lines.push(
                    '',
                    '### Build Log' + (truncated ? ' (truncated — showing tail)' : ''),
                    '```',
                    logSnippet,
                    '```',
                );
            }

            const isError = status !== 'success';

            resolve({
                content: [{ type: 'text', text: lines.join('\n') }],
                isError,
            });
        });

        child.on('error', (err: Error) => {
            clearTimeout(timer);
            clearTimeout(sigkillTimer);

            const durationMs = Date.now() - startTime;

            // ── Always invalidate cache ───────────────────────────────────────
            invalidate();

            resolve({
                content: [{
                    type: 'text',
                    text: [
                        '## Knowledge Base Rebuild: FAILURE',
                        '',
                        `**Status:** failure`,
                        `**Duration:** ${durationMs}ms`,
                        `**Error:** ${err.message}`,
                        `**Exit code:** N/A`,
                        `**Timed out:** false`,
                        `**Truncated:** false`,
                    ].join('\n'),
                }],
                isError: true,
            });
        });
    });
}
