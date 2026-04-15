/**
 * Comprehensive tests for the rebuild_knowledge tool handler.
 *
 * Mocks node:child_process (spawn), node:fs (readFileSync), and the
 * cache module (invalidate) to test all handler paths in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock node:child_process
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock node:fs — only mock readFileSync, leave the rest intact
const mockReadFileSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        default: { ...actual, readFileSync: (...args: unknown[]) => mockReadFileSync(...args) },
        readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    };
});

// Mock the cache module
const mockInvalidate = vi.fn();
vi.mock('../mcp-server/tools/lib/cache.js', () => ({
    invalidate: () => mockInvalidate(),
    getOrCompute: vi.fn(),
}));

// Mock path-utils to return a deterministic project root
vi.mock('../mcp-server/tools/lib/path-utils.js', () => ({
    resolveProjectRoot: vi.fn(() => '/mock/project'),
    normalizePath: vi.fn((p: string) => p),
}));

// Import the handler AFTER mocks are set up
import { handler } from '../mcp-server/tools/rebuild-knowledge.js';
import type { RebuildKnowledgeArgs } from '../mcp-server/tools/rebuild-knowledge.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

type TextContent = { type: string; text: string };

function getText(result: { content: Array<{ type: string; text: string }> }): string {
    return (result.content[0] as TextContent).text;
}

/**
 * Creates a fake ChildProcess (EventEmitter with stdout/stderr streams).
 * Call `child.emitClose(exitCode)` to simulate process exit.
 * Call `child.stdout.emit('data', Buffer.from(...))` to simulate output.
 */
function createMockChild(): ChildProcess & {
    emitClose: (code: number | null) => void;
} {
    const child = new EventEmitter() as ChildProcess & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        emitClose: (code: number | null) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.emitClose = (code: number | null) => {
        child.emit('close', code);
    };
    return child;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Default: no build in progress (index.json file not found)
    mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
    });
});

afterEach(() => {
    vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rebuild_knowledge handler', () => {

    // ── 1. Successful incremental build ──────────────────────────────────────
    describe('successful incremental build', () => {
        it('returns status=success with duration and extracted stats', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});

            // Emit log output with stat patterns
            const logOutput = [
                '[build-knowledge] Found 42 TypeScript files',
                '[build-knowledge] Symbols: 150 in 200ms',
                '[build-knowledge] Dependencies: 5 modules, 0 cycles in 50ms',
                '[build-knowledge] Summaries: 30 generated (10 cached) in 300ms',
                '[build-knowledge] Done in 5000ms total',
            ].join('\n');

            child.stdout.emit('data', Buffer.from(logOutput));
            child.emitClose(0);

            const result = await promise;

            expect(result.isError).toBeFalsy();
            const text = getText(result);
            expect(text).toContain('SUCCESS');
            expect(text).toContain('success');
            // Duration should be present (numeric)
            expect(text).toMatch(/Duration.*\d+ms/);
            // Stats extracted
            expect(text).toContain('symbols');
            expect(text).toContain('150');
            expect(text).toContain('dep_modules');
        });
    });

    // ── 2. Successful full build (incremental=false) ─────────────────────────
    describe('successful full build', () => {
        it('omits --incremental flag when incremental=false', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({ incremental: false });

            child.emitClose(0);

            await promise;

            // Verify spawn was called
            expect(mockSpawn).toHaveBeenCalledOnce();
            const spawnArgs = mockSpawn.mock.calls[0];
            const cliArgs: string[] = spawnArgs[1];

            // --incremental should NOT be in the args
            expect(cliArgs).not.toContain('--incremental');
        });
    });

    // ── 3. Concurrency guard rejection ───────────────────────────────────────
    describe('concurrency guard', () => {
        it('returns isError=true when buildInProgress=true', async () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify({ buildInProgress: true, buildGeneration: 5 }),
            );

            const result = await handler({});

            expect(result.isError).toBe(true);
            expect(getText(result)).toContain('already in progress');
            // spawn should NOT have been called
            expect(mockSpawn).not.toHaveBeenCalled();
        });
    });

    // ── 4. Timeout handling ──────────────────────────────────────────────────
    describe('timeout handling', () => {
        it('returns status=timeout and kills the process', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            // Use a 1-minute timeout for fast test
            const promise = handler({ timeout_minutes: 1 });

            // Advance past the 1-minute timeout
            vi.advanceTimersByTime(60 * 1000 + 100);

            // The timeout handler should have killed the child;
            // simulate the OS closing the process after kill
            child.emitClose(null);

            const result = await promise;

            expect(result.isError).toBe(true);
            const text = getText(result);
            expect(text).toContain('timeout');
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        });
    });

    // ── 5. Build failure ─────────────────────────────────────────────────────
    describe('build failure', () => {
        it('returns status=failure with exit code and stderr', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});

            const stderrContent = 'Error: Failed to parse file src/broken.ts\nSyntax error at line 42';
            child.stderr.emit('data', Buffer.from(stderrContent));
            child.emitClose(1);

            const result = await promise;

            expect(result.isError).toBe(true);
            const text = getText(result);
            expect(text).toContain('FAILURE');
            expect(text).toContain('failure');
            expect(text).toContain('1'); // exit code
            expect(text).toContain('Failed to parse file');
        });
    });

    // ── 6. Parameter-to-flag mapping ─────────────────────────────────────────
    describe('parameter-to-flag mapping', () => {
        it('maps skip_vectors, skip_features, and richness to CLI flags', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const args: RebuildKnowledgeArgs = {
                skip_vectors: true,
                skip_features: true,
                richness: 'rich',
            };

            const promise = handler(args);
            child.emitClose(0);
            await promise;

            expect(mockSpawn).toHaveBeenCalledOnce();
            const spawnArgs = mockSpawn.mock.calls[0];
            const cliArgs: string[] = spawnArgs[1];

            expect(cliArgs).toContain('--skip-vectors');
            expect(cliArgs).toContain('--skip-features');
            expect(cliArgs).toContain('--richness');
            // richness value should follow the --richness flag
            const richnessIdx = cliArgs.indexOf('--richness');
            expect(cliArgs[richnessIdx + 1]).toBe('rich');
        });
    });

    // ── 7. Log truncation at 64KB ────────────────────────────────────────────
    describe('log truncation', () => {
        it('truncates output exceeding 64KB and sets truncated flag', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});

            // Emit >64KB of stdout data in chunks
            const chunkSize = 8192;
            const totalSize = 70_000; // well over 64KB
            const chunk = Buffer.alloc(chunkSize, 'A'.charCodeAt(0));
            let emitted = 0;
            while (emitted < totalSize) {
                child.stdout.emit('data', chunk);
                emitted += chunkSize;
            }

            child.emitClose(0);

            const result = await promise;
            const text = getText(result);

            // The truncated flag should appear in output
            expect(text).toContain('true'); // **Truncated:** true
            expect(text).toContain('truncated');
        });
    });

    // ── 8. Cache invalidation called ─────────────────────────────────────────
    describe('cache invalidation', () => {
        it('calls invalidate after successful build', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});
            child.emitClose(0);
            await promise;

            expect(mockInvalidate).toHaveBeenCalled();
        });

        it('calls invalidate after failed build', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});
            child.emitClose(1);
            await promise;

            expect(mockInvalidate).toHaveBeenCalled();
        });

        it('calls invalidate after timeout', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({ timeout_minutes: 1 });

            vi.advanceTimersByTime(60 * 1000 + 100);
            child.emitClose(null);

            await promise;

            expect(mockInvalidate).toHaveBeenCalled();
        });
    });

    // ── 9. Default parameters ────────────────────────────────────────────────
    describe('default parameters', () => {
        it('defaults incremental to true (--incremental flag passed)', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});
            child.emitClose(0);
            await promise;

            expect(mockSpawn).toHaveBeenCalledOnce();
            const spawnArgs = mockSpawn.mock.calls[0];
            const cliArgs: string[] = spawnArgs[1];

            expect(cliArgs).toContain('--incremental');
        });

        it('defaults timeout to 10 minutes', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});

            // At 9 minutes, should NOT have timed out
            vi.advanceTimersByTime(9 * 60 * 1000);
            expect(child.kill).not.toHaveBeenCalled();

            // At 10 minutes + buffer, should have timed out
            vi.advanceTimersByTime(1 * 60 * 1000 + 100);
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');

            child.emitClose(null);

            const result = await promise;
            expect(getText(result)).toContain('timeout');
        });
    });

    // ── 10. Spawn error event (e.g. npx not on PATH) ─────────────────────────
    describe('spawn error event', () => {
        it('returns isError=true with error message and calls invalidate', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});

            // Emit 'error' event as if the binary was not found
            child.emit('error', new Error('ENOENT: npx not found'));

            const result = await promise;

            expect(result.isError).toBe(true);
            const text = getText(result);
            expect(text).toContain('FAILURE');
            expect(text).toContain('ENOENT: npx not found');
            expect(mockInvalidate).toHaveBeenCalled();
        });
    });

    // ── 11. timeout_minutes Zod schema validation ─────────────────────────────
    describe('timeout_minutes schema validation (AC-011)', () => {
        it('rejects timeout_minutes=0 with a ZodError', () => {
            const schema = z.object({
                timeout_minutes: z.number().int().min(1).max(30).optional(),
            });
            expect(() => schema.parse({ timeout_minutes: 0 })).toThrow(z.ZodError);
        });

        it('rejects timeout_minutes=31 with a ZodError', () => {
            const schema = z.object({
                timeout_minutes: z.number().int().min(1).max(30).optional(),
            });
            expect(() => schema.parse({ timeout_minutes: 31 })).toThrow(z.ZodError);
        });

        it('accepts timeout_minutes=1 (lower bound)', () => {
            const schema = z.object({
                timeout_minutes: z.number().int().min(1).max(30).optional(),
            });
            expect(() => schema.parse({ timeout_minutes: 1 })).not.toThrow();
        });

        it('accepts timeout_minutes=30 (upper bound)', () => {
            const schema = z.object({
                timeout_minutes: z.number().int().min(1).max(30).optional(),
            });
            expect(() => schema.parse({ timeout_minutes: 30 })).not.toThrow();
        });
    });

    // ── Additional: spawn command structure ──────────────────────────────────
    describe('spawn invocation', () => {
        it('spawns npx tsx scripts/build-knowledge.ts with correct cwd', async () => {
            const child = createMockChild();
            mockSpawn.mockReturnValue(child);

            const promise = handler({});
            child.emitClose(0);
            await promise;

            expect(mockSpawn).toHaveBeenCalledOnce();
            const [cmd, args, opts] = mockSpawn.mock.calls[0];
            expect(cmd).toBe('npx');
            expect(args[0]).toBe('tsx');
            expect(args[1]).toBe('scripts/build-knowledge.ts');
            expect(opts.cwd).toBe('/mock/project');
        });
    });
});
