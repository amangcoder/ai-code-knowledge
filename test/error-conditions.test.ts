import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handler as findSymbol } from '../mcp-server/tools/find-symbol.js';
import { handler as findCallers } from '../mcp-server/tools/find-callers.js';
import { handler as getFileSummary } from '../mcp-server/tools/get-file-summary.js';
import { handler as getDependencies } from '../mcp-server/tools/get-dependencies.js';
import { handler as healthCheck } from '../mcp-server/tools/health-check.js';

let tempDir: string;

beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-conditions-'));
});

afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe('missing knowledge files', () => {
    it('find_symbol returns helpful error when symbols.json is missing', async () => {
        const result = await findSymbol({ name: 'foo' }, tempDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('build-knowledge');
    });

    it('find_callers returns helpful error when symbols.json is missing', async () => {
        const result = await findCallers({ symbol: 'foo' }, tempDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('build-knowledge');
    });

    it('get_file_summary handles missing cache gracefully', async () => {
        // Create summaries dir but no cache.json
        await fs.mkdir(path.join(tempDir, 'summaries'), { recursive: true });
        const result = await getFileSummary({ file: 'nonexistent.ts' }, tempDir);
        expect(result.isError).toBe(true);
    });

    it('get_dependencies handles missing dependencies.json', async () => {
        const result = await getDependencies({ module: 'foo' }, tempDir);
        expect(result.isError).toBe(true);
    });

    it('health_check returns status even when index.json is missing', async () => {
        const result = await healthCheck({}, tempDir);
        // health_check doesn't error — it reports whatever it finds
        expect(result.content).toBeDefined();
    });
});

describe('corrupt knowledge files', () => {
    let corruptDir: string;

    beforeAll(async () => {
        corruptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'corrupt-knowledge-'));
        // Write corrupt JSON
        await fs.writeFile(path.join(corruptDir, 'symbols.json'), '{invalid json!!!', 'utf8');
        await fs.mkdir(path.join(corruptDir, 'summaries'), { recursive: true });
        await fs.writeFile(path.join(corruptDir, 'summaries', 'cache.json'), 'not json', 'utf8');
        await fs.writeFile(path.join(corruptDir, 'dependencies.json'), '[broken', 'utf8');
        await fs.writeFile(path.join(corruptDir, 'index.json'), '{}', 'utf8');
    });

    afterAll(async () => {
        await fs.rm(corruptDir, { recursive: true, force: true });
    });

    it('find_symbol handles corrupt symbols.json', async () => {
        const result = await findSymbol({ name: 'foo' }, corruptDir);
        // Should either return error or empty results, not crash
        expect(result.content).toBeDefined();
    });

    it('find_callers handles corrupt symbols.json', async () => {
        const result = await findCallers({ symbol: 'foo' }, corruptDir);
        expect(result.content).toBeDefined();
    });

    it('get_dependencies handles corrupt dependencies.json', async () => {
        const result = await getDependencies({ module: 'foo' }, corruptDir);
        expect(result.content).toBeDefined();
    });
});

describe('empty results', () => {
    let emptyDir: string;

    beforeAll(async () => {
        emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-knowledge-'));
        await fs.writeFile(path.join(emptyDir, 'symbols.json'), '[]', 'utf8');
        await fs.writeFile(
            path.join(emptyDir, 'dependencies.json'),
            JSON.stringify({ nodes: [], edges: [], cycles: [], fileDeps: {} }),
            'utf8'
        );
        await fs.mkdir(path.join(emptyDir, 'summaries'), { recursive: true });
        await fs.writeFile(path.join(emptyDir, 'summaries', 'cache.json'), '{}', 'utf8');
    });

    afterAll(async () => {
        await fs.rm(emptyDir, { recursive: true, force: true });
    });

    it('find_symbol returns no results message for empty symbols', async () => {
        const result = await findSymbol({ name: 'anything' }, emptyDir);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('No symbols found');
    });

    it('find_callers returns not found for empty symbols', async () => {
        const result = await findCallers({ symbol: 'anything' }, emptyDir);
        expect(result.content[0].text).toContain('not found');
    });
});
