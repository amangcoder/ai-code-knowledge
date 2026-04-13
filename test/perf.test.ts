import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const TOTAL_FILES = 500;
const MAX_BUILD_TIME_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

let tempDir: string;

/**
 * Generate a random integer in [min, max] inclusive.
 */
function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build a valid TypeScript identifier for a file index.
 */
function moduleName(index: number): string {
    return `module${index}`;
}

/**
 * Generate a TypeScript source file with 1-3 exported functions and optional
 * imports from previously-created files (to keep the import graph acyclic).
 */
function generateFileContent(index: number): string {
    const lines: string[] = [];
    const funcCount = randInt(1, 3);

    // Import up to 2 earlier modules to create a realistic (acyclic) dependency graph
    const importCount = index > 0 ? randInt(0, Math.min(2, index)) : 0;
    const importedIndices = new Set<number>();
    while (importedIndices.size < importCount) {
        importedIndices.add(randInt(0, index - 1));
    }

    for (const imp of importedIndices) {
        lines.push(`import { fn0_${imp} } from './${moduleName(imp)}.js';`);
    }

    if (lines.length > 0) {
        lines.push('');
    }

    for (let f = 0; f < funcCount; f++) {
        const fnName = `fn${f}_${index}`;
        lines.push(`export function ${fnName}(x: number): number {`);

        if (f === 0 && importedIndices.size > 0) {
            // Call one imported function so the call graph has edges
            const [firstImp] = importedIndices;
            lines.push(`    return fn0_${firstImp}(x) + ${f};`);
        } else {
            lines.push(`    return x + ${f};`);
        }

        lines.push('}');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Generate a minimal tsconfig.json suitable for ts-morph to process all files.
 */
function generateTsConfig(): string {
    return JSON.stringify(
        {
            compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
            },
            include: ['src/**/*.ts'],
        },
        null,
        2
    );
}

beforeAll(() => {
    // Create a temporary directory tree: <tempDir>/src/
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Write tsconfig.json at the project root
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), generateTsConfig(), 'utf-8');

    // Generate TOTAL_FILES TypeScript source files
    for (let i = 0; i < TOTAL_FILES; i++) {
        const filePath = path.join(srcDir, `${moduleName(i)}.ts`);
        fs.writeFileSync(filePath, generateFileContent(i), 'utf-8');
    }
}, TEST_TIMEOUT_MS);

afterAll(() => {
    // Clean up all generated files and the temp directory
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

describe('build-knowledge performance benchmark', () => {
    it(
        `completes full build of ${TOTAL_FILES} files in under ${MAX_BUILD_TIME_MS / 1000}s`,
        () => {
            const buildKnowledgeScript = path.join(PROJECT_ROOT, 'scripts', 'build-knowledge.ts');

            // Locate tsx binary (devDependency)
            const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

            const startTime = Date.now();

            execFileSync(tsxBin, [buildKnowledgeScript, '--root', tempDir], {
                env: {
                    ...process.env,
                    SUMMARIZER_MODE: 'static',
                },
                stdio: 'pipe', // suppress output; errors will still throw
                timeout: TEST_TIMEOUT_MS,
            });

            const elapsed = Date.now() - startTime;

            // Assert that the four expected knowledge artifacts were produced
            const knowledgeDir = path.join(tempDir, '.knowledge');
            expect(fs.existsSync(path.join(knowledgeDir, 'symbols.json')), 'symbols.json should exist').toBe(true);
            expect(fs.existsSync(path.join(knowledgeDir, 'dependencies.json')), 'dependencies.json should exist').toBe(true);
            expect(fs.existsSync(path.join(knowledgeDir, 'summaries', 'cache.json')), 'summaries/cache.json should exist').toBe(true);
            expect(fs.existsSync(path.join(knowledgeDir, 'index.json')), 'index.json should exist').toBe(true);

            // Performance assertion: must complete within the budget
            expect(
                elapsed,
                `Build took ${elapsed}ms — expected < ${MAX_BUILD_TIME_MS}ms`
            ).toBeLessThan(MAX_BUILD_TIME_MS);
        },
        TEST_TIMEOUT_MS
    );
});
