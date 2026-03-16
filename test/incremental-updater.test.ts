import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { handleFileChange, handleFileDeletion } from '../scripts/lib/incremental-updater.js';
import type { SymbolEntry } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/sample-project');
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

let tempDir: string;
let knowledgeRoot: string;

/**
 * Copy the fixture project to a temp directory so we can modify files
 * without affecting the original fixtures.
 */
function copyFixture(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-updater-test-'));
    for (const file of fs.readdirSync(FIXTURE_DIR)) {
        fs.copyFileSync(path.join(FIXTURE_DIR, file), path.join(tmpDir, file));
    }
    return tmpDir;
}

function loadSymbols(knRoot: string): SymbolEntry[] {
    const symbolsPath = path.join(knRoot, 'symbols.json');
    if (!fs.existsSync(symbolsPath)) return [];
    return JSON.parse(fs.readFileSync(symbolsPath, 'utf-8')) as SymbolEntry[];
}

beforeAll(() => {
    // Create a working copy of the fixture
    tempDir = copyFixture();
    knowledgeRoot = path.join(tempDir, '.knowledge');

    // Build the initial knowledge base
    execFileSync(
        TSX_BIN,
        ['scripts/build-knowledge.ts', '--root', tempDir],
        { cwd: PROJECT_ROOT, stdio: 'pipe' }
    );
}, 30_000);

afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

describe('handleFileChange', () => {
    it('resolves cross-file calls after incremental update', async () => {
        // Modify analytics-service.ts to add a new function that calls nothing
        const analyticsPath = path.join(tempDir, 'analytics-service.ts');
        const original = fs.readFileSync(analyticsPath, 'utf-8');
        const modified = original + `
export function newAnalyticsHelper(): void {
    track({ eventName: 'helper_called' });
}
`;
        fs.writeFileSync(analyticsPath, modified, 'utf-8');

        await handleFileChange(analyticsPath, knowledgeRoot, tempDir);

        const symbols = loadSymbols(knowledgeRoot);

        // The new function should exist
        const helper = symbols.find(s => s.name === 'newAnalyticsHelper');
        expect(helper).toBeDefined();
        expect(helper!.file).toContain('analytics-service');

        // Cross-file calls should still be resolved:
        // createOrder (in order-service.ts) should still call charge and track
        const createOrder = symbols.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calls).toContain('charge');
        expect(createOrder!.calls).toContain('track');

        // The new helper calls track — this is a within-file call that should resolve
        expect(helper!.calls).toContain('track');

        // Restore original file
        fs.writeFileSync(analyticsPath, original, 'utf-8');
        await handleFileChange(analyticsPath, knowledgeRoot, tempDir);
    }, 15_000);

    it('preserves calledBy entries from other files after update', async () => {
        // Touch order-service.ts (no real change, just re-process)
        const orderPath = path.join(tempDir, 'order-service.ts');

        await handleFileChange(orderPath, knowledgeRoot, tempDir);

        const symbols = loadSymbols(knowledgeRoot);

        // charge should still be calledBy createOrder
        const charge = symbols.find(s => s.name === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.calledBy).toContain('createOrder');

        // track should still be calledBy createOrder
        const track = symbols.find(s => s.name === 'track');
        expect(track).toBeDefined();
        expect(track!.calledBy).toContain('createOrder');
    }, 15_000);
});

describe('handleFileDeletion', () => {
    it('removes symbols and cleans calledBy references for deleted file', async () => {
        // Add a temporary file, build it, then delete it
        const tmpFilePath = path.join(tempDir, 'temp-service.ts');
        fs.writeFileSync(tmpFilePath, `
export function tempFunc(): void {}
`, 'utf-8');

        // Process the new file
        await handleFileChange(tmpFilePath, knowledgeRoot, tempDir);

        let symbols = loadSymbols(knowledgeRoot);
        expect(symbols.find(s => s.name === 'tempFunc')).toBeDefined();

        // Delete the file
        fs.unlinkSync(tmpFilePath);
        await handleFileDeletion(tmpFilePath, knowledgeRoot);

        symbols = loadSymbols(knowledgeRoot);

        // tempFunc should be gone
        expect(symbols.find(s => s.name === 'tempFunc')).toBeUndefined();

        // Other symbols should still exist
        expect(symbols.find(s => s.name === 'createOrder')).toBeDefined();
        expect(symbols.find(s => s.name === 'charge')).toBeDefined();
    }, 15_000);
});
