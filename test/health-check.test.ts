import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handler } from '../mcp-server/tools/health-check.js';
import type { KnowledgeIndex } from '../src/types.js';

type TextContent = { type: string; text: string };

const TEST_DIR = join(tmpdir(), `health-check-test-${Date.now()}`);

async function writeIndex(index: KnowledgeIndex): Promise<void> {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, 'index.json'), JSON.stringify(index), 'utf-8');
}

afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
});

describe('health_check tool', () => {
    describe('when index.json exists', () => {
        beforeAll(async () => {
            const index: KnowledgeIndex = {
                lastBuilt: '2024-01-15T10:30:00.000Z',
                fileCount: 42,
                hasSymbols: true,
                hasDependencies: true,
                modules: ['auth', 'payments', 'analytics'],
                summaries: [],
            };
            await writeIndex(index);
        });

        it('returns a CallToolResult with text content', async () => {
            const result = await handler({}, TEST_DIR);
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe('text');
        });

        it('includes lastBuilt timestamp in the response', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('2024-01-15T10:30:00.000Z');
        });

        it('includes fileCount in the response', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('42');
        });

        it('shows hasSymbols as "yes" when true', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('Has Symbols:      yes');
        });

        it('shows hasDependencies as "yes" when true', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('Has Dependencies: yes');
        });

        it('lists all modules', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('auth');
            expect(text).toContain('payments');
            expect(text).toContain('analytics');
        });

        it('is human-readable plain text', async () => {
            const result = await handler({}, TEST_DIR);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('Knowledge Base Status');
            expect(text).toContain('Last Built:');
            expect(text).toContain('File Count:');
            expect(text).toContain('Modules:');
        });
    });

    describe('when hasSymbols is false and hasDependencies is false', () => {
        const noFlagsDir = join(tmpdir(), `health-check-noflags-${Date.now()}`);

        beforeAll(async () => {
            const index: KnowledgeIndex = {
                lastBuilt: '2024-01-01T00:00:00.000Z',
                fileCount: 0,
                hasSymbols: false,
                hasDependencies: false,
                modules: [],
                summaries: [],
            };
            await mkdir(noFlagsDir, { recursive: true });
            await writeFile(join(noFlagsDir, 'index.json'), JSON.stringify(index), 'utf-8');
        });

        afterAll(async () => {
            await rm(noFlagsDir, { recursive: true, force: true });
        });

        it('shows hasSymbols as "no" when false', async () => {
            const result = await handler({}, noFlagsDir);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('Has Symbols:      no');
        });

        it('shows hasDependencies as "no" when false', async () => {
            const result = await handler({}, noFlagsDir);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('Has Dependencies: no');
        });

        it('shows "(none)" for empty modules list', async () => {
            const result = await handler({}, noFlagsDir);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('(none)');
        });
    });

    describe('when index.json is missing', () => {
        const emptyDir = join(tmpdir(), `health-check-empty-${Date.now()}`);

        beforeAll(async () => {
            await mkdir(emptyDir, { recursive: true });
        });

        afterAll(async () => {
            await rm(emptyDir, { recursive: true, force: true });
        });

        it('returns a build instruction message', async () => {
            const result = await handler({}, emptyDir);
            expect(result.content).toHaveLength(1);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('npm run build-knowledge');
        });

        it('tells the user to build first', async () => {
            const result = await handler({}, emptyDir);
            const text = (result.content[0] as { type: string; text: string }).text;
            expect(text).toContain('build');
        });

        it('still returns a CallToolResult with text content', async () => {
            const result = await handler({}, emptyDir);
            expect(result.content[0].type).toBe('text');
        });
    });
});
