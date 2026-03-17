#!/usr/bin/env node
/**
 * build-knowledge — Entry point for the incremental knowledge indexer.
 *
 * Usage:
 *   node src/build-knowledge.js [options]
 *
 * Options:
 *   --full               Force a full rebuild (ignores change detection)
 *   --dry-run            Show what would be re-indexed without writing
 *   --summarizer=static  Summarizer mode: static (default), anthropic, claude-code
 *   --root=<path>        Project root (default: current directory)
 *   --knowledge=<path>   Knowledge root (default: <root>/.knowledge)
 *
 * Environment variables:
 *   KNOWLEDGE_ROOT       Overrides --knowledge path
 *   ANTHROPIC_API_KEY    Required when --summarizer=anthropic
 *   PROJECT_ROOT         Overrides --root path
 */

import * as path from 'node:path';
import { runIndexer } from './indexer.js';
import type { SummarizerMode } from './summarizer.js';

function parseArgs(argv: string[]): {
    fullRebuild: boolean;
    dryRun: boolean;
    summarizer: SummarizerMode;
    projectRoot: string;
    knowledgeRoot: string;
} {
    const args = argv.slice(2);

    const fullRebuild = args.includes('--full');
    const dryRun = args.includes('--dry-run');

    const summarizerArg = args.find(a => a.startsWith('--summarizer='));
    const summarizer: SummarizerMode = (summarizerArg?.split('=')[1] as SummarizerMode) ?? 'static';

    const rootArg = args.find(a => a.startsWith('--root='));
    const projectRoot =
        rootArg?.split('=')[1] ??
        process.env['PROJECT_ROOT'] ??
        process.cwd();

    const knowledgeArg = args.find(a => a.startsWith('--knowledge='));
    const knowledgeRoot =
        knowledgeArg?.split('=')[1] ??
        process.env['KNOWLEDGE_ROOT'] ??
        path.join(projectRoot, '.knowledge');

    return {
        fullRebuild,
        dryRun,
        summarizer,
        projectRoot: path.resolve(projectRoot),
        knowledgeRoot: path.resolve(knowledgeRoot),
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv);

    process.stderr.write(
        `[build-knowledge] Project root: ${options.projectRoot}\n` +
        `[build-knowledge] Knowledge root: ${options.knowledgeRoot}\n` +
        `[build-knowledge] Mode: ${options.fullRebuild ? 'full rebuild' : 'incremental'}` +
        `${options.dryRun ? ' (dry-run)' : ''}\n` +
        `[build-knowledge] Summarizer: ${options.summarizer}\n`
    );

    const startTime = Date.now();

    await runIndexer({
        projectRoot: options.projectRoot,
        knowledgeRoot: options.knowledgeRoot,
        fullRebuild: options.fullRebuild,
        dryRun: options.dryRun,
        summarizer: options.summarizer,
    });

    const elapsed = Date.now() - startTime;
    process.stderr.write(`[build-knowledge] Completed in ${elapsed}ms\n`);
}

main().catch((err: unknown) => {
    process.stderr.write(
        `[build-knowledge] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    if (err instanceof Error && err.stack) {
        process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
});
