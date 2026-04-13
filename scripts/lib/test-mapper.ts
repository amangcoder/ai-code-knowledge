import * as path from 'node:path';

/**
 * Patterns that identify test files across languages.
 */
const TEST_FILE_PATTERNS = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.py$/,
    /^test_.*\.py$/,
    /\.test\.mjs$/,
];

/**
 * Check if a file path is a test file.
 */
function isTestFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    return TEST_FILE_PATTERNS.some(pattern => pattern.test(basename));
}

/**
 * Infer the source file that a test file is testing based on naming conventions.
 * e.g., "foo.test.ts" → "foo.ts", "test_bar.py" → "bar.py"
 */
function inferSourceFile(testFile: string): string | undefined {
    const basename = path.basename(testFile);
    const dir = path.dirname(testFile);

    // foo.test.ts → foo.ts, foo.spec.tsx → foo.tsx
    const testSuffixMatch = basename.match(/^(.+)\.(test|spec)(\.[jt]sx?|\.mjs)$/);
    if (testSuffixMatch) {
        return path.join(dir, testSuffixMatch[1] + testSuffixMatch[3]);
    }

    // _test.py → .py, test_.py → .py
    const pyTestSuffix = basename.match(/^(.+)_test\.py$/);
    if (pyTestSuffix) {
        return path.join(dir, pyTestSuffix[1] + '.py');
    }
    const pyTestPrefix = basename.match(/^test_(.+)\.py$/);
    if (pyTestPrefix) {
        return path.join(dir, pyTestPrefix[1] + '.py');
    }

    return undefined;
}

export interface TestMap {
    /** source file (relative path) → test files (relative paths) */
    sourceToTests: Record<string, string[]>;
}

/**
 * Build a mapping from source files to their test files.
 *
 * Uses two strategies:
 * 1. Naming convention: foo.test.ts tests foo.ts
 * 2. Import analysis: if a test file imports a source file, it's mapped
 *
 * @param allFiles All relative file paths in the project
 * @param fileDeps File-level dependency map (file → imported files)
 */
export function buildTestMap(
    allFiles: string[],
    fileDeps: Record<string, string[]>
): TestMap {
    const sourceToTests: Record<string, string[]> = {};
    const testFiles = allFiles.filter(isTestFile);

    for (const testFile of testFiles) {
        const mappedSources = new Set<string>();

        // Strategy 1: naming convention
        const inferred = inferSourceFile(testFile);
        if (inferred) {
            // Check multiple directory possibilities: same dir, parent src/ dir
            const candidates = [
                inferred,
                // test/ → src/ mapping: test/foo.test.ts → src/foo.ts
                inferred.replace(/^test\//, 'src/'),
                inferred.replace(/^tests\//, 'src/'),
                // __tests__/ → parent dir
                inferred.replace(/__tests__\//, ''),
            ];
            for (const candidate of candidates) {
                if (allFiles.includes(candidate)) {
                    mappedSources.add(candidate);
                }
            }
        }

        // Strategy 2: import analysis
        const deps = fileDeps[testFile];
        if (deps) {
            for (const dep of deps) {
                if (!isTestFile(dep) && allFiles.includes(dep)) {
                    mappedSources.add(dep);
                }
            }
        }

        // Add to map
        for (const source of mappedSources) {
            if (!sourceToTests[source]) {
                sourceToTests[source] = [];
            }
            if (!sourceToTests[source].includes(testFile)) {
                sourceToTests[source].push(testFile);
            }
        }
    }

    return { sourceToTests };
}
