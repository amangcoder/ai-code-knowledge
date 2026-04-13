import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex, writeIndex } from '../scripts/lib/index-builder.js';
import type { KnowledgeIndex, SymbolEntry, DependencyGraph, FileSummary } from '../src/types.js';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'index-builder-test-'));
}

function writeJson(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

describe('buildIndex', () => {
    let knowledgeRoot: string;

    beforeEach(() => {
        knowledgeRoot = makeTempDir();
    });

    afterEach(() => {
        fs.rmSync(knowledgeRoot, { recursive: true, force: true });
    });

    it('returns valid KnowledgeIndex with empty state when no artifacts exist', async () => {
        const index = await buildIndex(knowledgeRoot);

        expect(index.hasSymbols).toBe(false);
        expect(index.hasDependencies).toBe(false);
        expect(index.modules).toEqual([]);
        expect(index.summaries).toEqual([]);
        expect(index.fileCount).toBe(0);
        expect(typeof index.lastBuilt).toBe('string');
        expect(new Date(index.lastBuilt).toISOString()).toBe(index.lastBuilt);
    });

    it('sets hasSymbols=true when symbols.json exists and is non-empty', async () => {
        const symbols: SymbolEntry[] = [
            {
                name: 'createOrder',
                qualifiedName: 'createOrder',
                file: 'src/order-service.ts',
                line: 5,
                signature: 'function createOrder()',
                type: 'function',
                module: 'src',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: true,
            },
        ];
        writeJson(path.join(knowledgeRoot, 'symbols.json'), symbols);

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasSymbols).toBe(true);
    });

    it('sets hasSymbols=false when symbols.json is an empty array', async () => {
        writeJson(path.join(knowledgeRoot, 'symbols.json'), []);

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasSymbols).toBe(false);
    });

    it('counts unique files in symbols.json for fileCount', async () => {
        const symbols: SymbolEntry[] = [
            {
                name: 'foo',
                qualifiedName: 'foo',
                file: 'src/a.ts',
                line: 1,
                signature: 'function foo()',
                type: 'function',
                module: 'src',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: true,
            },
            {
                name: 'bar',
                qualifiedName: 'bar',
                file: 'src/a.ts',
                line: 10,
                signature: 'function bar()',
                type: 'function',
                module: 'src',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: false,
            },
            {
                name: 'baz',
                qualifiedName: 'baz',
                file: 'src/b.ts',
                line: 1,
                signature: 'function baz()',
                type: 'function',
                module: 'src',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: true,
            },
        ];
        writeJson(path.join(knowledgeRoot, 'symbols.json'), symbols);

        const index = await buildIndex(knowledgeRoot);

        // 3 symbols across 2 unique files
        expect(index.fileCount).toBe(2);
    });

    it('populates modules from dependencies.json nodes array', async () => {
        const deps: DependencyGraph = {
            nodes: ['orders', 'payments', 'analytics'],
            edges: [{ from: 'orders', to: 'payments', type: 'direct' }],
            cycles: [],
            fileDeps: {},
        };
        writeJson(path.join(knowledgeRoot, 'dependencies.json'), deps);

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasDependencies).toBe(true);
        expect(index.modules).toEqual(['orders', 'payments', 'analytics']);
    });

    it('sets hasDependencies=false when dependencies.json has empty nodes', async () => {
        const deps: DependencyGraph = {
            nodes: [],
            edges: [],
            cycles: [],
            fileDeps: {},
        };
        writeJson(path.join(knowledgeRoot, 'dependencies.json'), deps);

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasDependencies).toBe(false);
    });

    it('populates summaries from summaries/cache.json keys', async () => {
        const cache: Record<string, FileSummary> = {
            'src/order-service.ts': {
                file: 'src/order-service.ts',
                purpose: 'Handles orders',
                exports: ['createOrder'],
                dependencies: [],
                sideEffects: [],
                throws: [],
                lastUpdated: new Date().toISOString(),
                contentHash: 'abc123',
            },
            'src/payment-service.ts': {
                file: 'src/payment-service.ts',
                purpose: 'Handles payments',
                exports: ['charge'],
                dependencies: [],
                sideEffects: [],
                throws: [],
                lastUpdated: new Date().toISOString(),
                contentHash: 'def456',
            },
        };
        writeJson(path.join(knowledgeRoot, 'summaries', 'cache.json'), cache);

        const index = await buildIndex(knowledgeRoot);

        expect(index.summaries).toHaveLength(2);
        expect(index.summaries).toContain('src/order-service.ts');
        expect(index.summaries).toContain('src/payment-service.ts');
    });

    it('sets lastBuilt to a current ISO timestamp', async () => {
        const before = new Date();
        const index = await buildIndex(knowledgeRoot);
        const after = new Date();

        const lastBuilt = new Date(index.lastBuilt);
        expect(lastBuilt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(lastBuilt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('handles malformed symbols.json gracefully', async () => {
        fs.writeFileSync(path.join(knowledgeRoot, 'symbols.json'), 'not valid json', 'utf8');

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasSymbols).toBe(false);
        expect(index.fileCount).toBe(0);
    });

    it('handles malformed dependencies.json gracefully', async () => {
        fs.writeFileSync(path.join(knowledgeRoot, 'dependencies.json'), '{bad json', 'utf8');

        const index = await buildIndex(knowledgeRoot);

        expect(index.hasDependencies).toBe(false);
        expect(index.modules).toEqual([]);
    });
});

describe('writeIndex', () => {
    let knowledgeRoot: string;

    beforeEach(() => {
        knowledgeRoot = makeTempDir();
    });

    afterEach(() => {
        fs.rmSync(knowledgeRoot, { recursive: true, force: true });
    });

    it('writes index.json to the knowledge root', async () => {
        const index: KnowledgeIndex = {
            modules: ['orders', 'payments'],
            summaries: ['src/order-service.ts'],
            hasSymbols: true,
            hasDependencies: true,
            lastBuilt: new Date().toISOString(),
            fileCount: 5,
        };

        await writeIndex(knowledgeRoot, index);

        const indexPath = path.join(knowledgeRoot, 'index.json');
        expect(fs.existsSync(indexPath)).toBe(true);

        const written = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as KnowledgeIndex;
        expect(written).toEqual(index);
    });

    it('creates parent directories if they do not exist', async () => {
        const nestedRoot = path.join(knowledgeRoot, 'nested', 'knowledge');
        const index: KnowledgeIndex = {
            modules: [],
            summaries: [],
            hasSymbols: false,
            hasDependencies: false,
            lastBuilt: new Date().toISOString(),
            fileCount: 0,
        };

        await writeIndex(nestedRoot, index);

        expect(fs.existsSync(path.join(nestedRoot, 'index.json'))).toBe(true);
    });

    it('overwrites an existing index.json atomically', async () => {
        const initial: KnowledgeIndex = {
            modules: [],
            summaries: [],
            hasSymbols: false,
            hasDependencies: false,
            lastBuilt: '2025-01-01T00:00:00.000Z',
            fileCount: 0,
        };
        writeJson(path.join(knowledgeRoot, 'index.json'), initial);

        const updated: KnowledgeIndex = {
            modules: ['lib'],
            summaries: ['src/lib.ts'],
            hasSymbols: true,
            hasDependencies: false,
            lastBuilt: new Date().toISOString(),
            fileCount: 3,
        };
        await writeIndex(knowledgeRoot, updated);

        const written = JSON.parse(
            fs.readFileSync(path.join(knowledgeRoot, 'index.json'), 'utf8')
        ) as KnowledgeIndex;
        expect(written.modules).toEqual(['lib']);
        expect(written.hasSymbols).toBe(true);
        expect(written.fileCount).toBe(3);
    });
});
