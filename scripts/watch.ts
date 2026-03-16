import chokidar from 'chokidar';
import * as path from 'node:path';
import { handleFileChange, handleFileDeletion } from './lib/incremental-updater.js';

const DEBOUNCE_MS = 500;
const WATCH_GLOB = 'src/**/*.{ts,tsx,js,py,go,rs}';

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

    process.stderr.write(`[watch] Starting file watcher for: ${projectRoot}\n`);
    process.stderr.write(`[watch] Watching: ${watchPattern}\n`);
    process.stderr.write(`[watch] Knowledge root: ${knowledgeRoot}\n`);

    // Pending changed files and deletion flags, keyed by file path
    const pendingChanges = new Map<string, 'change' | 'delete'>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Flush all pending changes after the debounce interval.
     */
    async function flushPending(): Promise<void> {
        if (pendingChanges.size === 0) return;

        const toProcess = new Map(pendingChanges);
        pendingChanges.clear();

        for (const [filePath, eventType] of toProcess) {
            if (eventType === 'delete') {
                process.stderr.write(`[watch] Processing deletion: ${filePath}\n`);
                try {
                    await handleFileDeletion(filePath, knowledgeRoot);
                    process.stderr.write(`[watch] Deletion processed: ${filePath}\n`);
                } catch (err) {
                    process.stderr.write(`[watch] Error processing deletion for ${filePath}: ${err}\n`);
                }
            } else {
                process.stderr.write(`[watch] Processing change: ${filePath}\n`);
                try {
                    await handleFileChange(filePath, knowledgeRoot, projectRoot);
                    process.stderr.write(`[watch] Change processed: ${filePath}\n`);
                } catch (err) {
                    process.stderr.write(`[watch] Error processing change for ${filePath}: ${err}\n`);
                }
            }
        }
    }

    /**
     * Schedule a debounced flush of all pending changes.
     */
    function scheduleFlushed(): void {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flushPending().catch(err => {
                process.stderr.write(`[watch] Unexpected error during flush: ${err}\n`);
            });
        }, DEBOUNCE_MS);
    }

    const watcher = chokidar.watch(watchPattern, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
    });

    watcher.on('add', (filePath: string) => {
        process.stderr.write(`[watch] File added: ${filePath}\n`);
        pendingChanges.set(filePath, 'change');
        scheduleFlushed();
    });

    watcher.on('change', (filePath: string) => {
        process.stderr.write(`[watch] File changed: ${filePath}\n`);
        pendingChanges.set(filePath, 'change');
        scheduleFlushed();
    });

    watcher.on('unlink', (filePath: string) => {
        process.stderr.write(`[watch] File deleted: ${filePath}\n`);
        pendingChanges.set(filePath, 'delete');
        scheduleFlushed();
    });

    watcher.on('error', (error: Error) => {
        process.stderr.write(`[watch] Watcher error: ${error}\n`);
    });

    watcher.on('ready', () => {
        process.stderr.write(`[watch] Ready — watching for file changes (debounce: ${DEBOUNCE_MS}ms)\n`);
    });

    /**
     * Graceful shutdown: close the watcher and flush any remaining pending changes.
     */
    async function shutdown(signal: string): Promise<void> {
        process.stderr.write(`\n[watch] Received ${signal}, shutting down gracefully...\n`);

        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        await watcher.close();
        process.stderr.write(`[watch] Watcher closed.\n`);
        process.exit(0);
    }

    process.on('SIGINT', () => {
        shutdown('SIGINT').catch(err => {
            process.stderr.write(`[watch] Error during shutdown: ${err}\n`);
            process.exit(1);
        });
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM').catch(err => {
            process.stderr.write(`[watch] Error during shutdown: ${err}\n`);
            process.exit(1);
        });
    });
}

main().catch(err => {
    process.stderr.write(`[watch] Fatal error: ${err}\n`);
    process.exit(1);
});
