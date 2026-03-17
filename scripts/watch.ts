import chokidar from 'chokidar';
import * as path from 'node:path';
import { handleBatchFileChanges } from './lib/incremental-updater.js';
import { logInfo, logError } from './lib/logger.js';
import { createDefaultRegistry } from './lib/adapters/index.js';

const DEBOUNCE_MS = 500;
const MAX_PENDING = 1000;

// Derive watch glob from all registered language adapters
const registry = createDefaultRegistry();
const WATCH_GLOB = registry.getSourceGlobs()[0] ?? '**/*.{ts,tsx,js,jsx,mjs,py}';

/**
 * File Watcher - watches source files for changes and triggers incremental knowledge updates.
 *
 * Usage: tsx scripts/watch.ts [--root <path>]
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const rootIndex = args.indexOf('--root');
    const projectRoot = rootIndex !== -1
        ? path.resolve(args[rootIndex + 1])
        : process.cwd();

    const knowledgeRoot = path.join(projectRoot, '.knowledge');
    const watchPattern = path.join(projectRoot, WATCH_GLOB);

    logInfo('watch', `Starting file watcher for: ${projectRoot}`);
    logInfo('watch', `Watching: ${watchPattern}`);
    logInfo('watch', `Knowledge root: ${knowledgeRoot}`);

    // Pending changed files and deletion flags, keyed by file path
    const pendingChanges = new Map<string, 'change' | 'delete'>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let isProcessing = false;

    /**
     * Flush all pending changes after the debounce interval.
     */
    async function flushPending(): Promise<void> {
        if (pendingChanges.size === 0 || isProcessing) return;

        isProcessing = true;
        const toProcess = new Map(pendingChanges);
        pendingChanges.clear();

        try {
            const batchFiles = Array.from(toProcess.entries()).map(([filePath, eventType]) => ({
                path: filePath,
                type: eventType,
            }));

            logInfo('watch', `Processing batch of ${batchFiles.length} file(s): ${batchFiles.map(f => `${f.type}:${path.basename(f.path)}`).join(', ')}`);

            await handleBatchFileChanges(batchFiles, knowledgeRoot, projectRoot);

            logInfo('watch', `Batch of ${batchFiles.length} file(s) processed successfully`);
        } catch (err) {
            logError('watch', err);
        } finally {
            isProcessing = false;
        }

        // Re-schedule if more changes accumulated during processing
        if (pendingChanges.size > 0) {
            scheduleFlushed();
        }
    }

    /**
     * Schedule a debounced flush of all pending changes.
     */
    function scheduleFlushed(): void {
        if (pendingChanges.size >= MAX_PENDING) {
            logInfo('watch', `Pending changes reached ${MAX_PENDING}, flushing immediately`);
            if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            flushPending().catch(err => {
                logError('watch', err);
            });
            return;
        }
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flushPending().catch(err => {
                logError('watch', err);
            });
        }, DEBOUNCE_MS);
    }

    const watcher = chokidar.watch(watchPattern, {
        ignoreInitial: true,
        persistent: true,
        ignored: [...registry.getIgnoreGlobs(), '**/.git/**'],
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
    });

    watcher.on('add', (filePath: string) => {
        logInfo('watch', `File added: ${filePath}`);
        pendingChanges.set(filePath, 'change');
        scheduleFlushed();
    });

    watcher.on('change', (filePath: string) => {
        logInfo('watch', `File changed: ${filePath}`);
        pendingChanges.set(filePath, 'change');
        scheduleFlushed();
    });

    watcher.on('unlink', (filePath: string) => {
        logInfo('watch', `File deleted: ${filePath}`);
        pendingChanges.set(filePath, 'delete');
        scheduleFlushed();
    });

    watcher.on('error', (error: Error) => {
        logError('watch', error);
    });

    watcher.on('ready', () => {
        logInfo('watch', `Ready — watching for file changes (debounce: ${DEBOUNCE_MS}ms)`);
    });

    /**
     * Graceful shutdown: close the watcher and flush any remaining pending changes.
     */
    async function shutdown(signal: string): Promise<void> {
        logInfo('watch', `Received ${signal}, shutting down gracefully...`);

        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        // Flush any remaining pending changes before shutdown
        if (pendingChanges.size > 0) {
            logInfo('watch', `Flushing ${pendingChanges.size} pending changes before shutdown...`);
            await flushPending();
        }

        await watcher.close();
        logInfo('watch', 'Watcher closed.');
        process.exit(0);
    }

    process.on('SIGINT', () => {
        shutdown('SIGINT').catch(err => {
            logError('watch', err);
            process.exit(1);
        });
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM').catch(err => {
            logError('watch', err);
            process.exit(1);
        });
    });
}

main().catch(err => {
    logError('watch', err);
    process.exit(1);
});
