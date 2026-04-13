import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

const IMPORT_PATTERN = /^import\s+([\w.]+)/gm;
const FROM_IMPORT_PATTERN = /^from\s+([\w.]+)\s+import/gm;
const RELATIVE_IMPORT_PATTERN = /^from\s+(\.+[\w.]*)\s+import/gm;

function tryResolve(base: string): string | null {
    const asPy = base + '.py';
    if (fs.existsSync(asPy)) {
        return asPy;
    }
    const asInit = path.join(base, '__init__.py');
    if (fs.existsSync(asInit)) {
        return asInit;
    }
    return null;
}

function resolveRelativeImport(filePath: string, modulePath: string): string | null {
    const fileDir = path.dirname(filePath);

    let dotCount = 0;
    while (dotCount < modulePath.length && modulePath[dotCount] === '.') {
        dotCount++;
    }

    // Go up (dotCount - 1) directories from the current file's directory.
    // A single dot means the current package (same directory), two dots means
    // one directory up, and so on.
    let baseDir = fileDir;
    for (let i = 1; i < dotCount; i++) {
        baseDir = path.dirname(baseDir);
    }

    const remainder = modulePath.slice(dotCount);
    if (remainder) {
        const segments = remainder.split('.');
        const resolved = path.join(baseDir, ...segments);
        return tryResolve(resolved);
    }

    return tryResolve(baseDir);
}

function resolveAbsoluteImport(modulePath: string, projectRoot: string): string | null {
    const segments = modulePath.split('.');
    const resolved = path.join(projectRoot, ...segments);
    return tryResolve(resolved);
}

export function extractPythonDeps(filePath: string, content: string, projectRoot: string): ImportInfo[] {
    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    function addResult(resolvedPath: string): void {
        if (!seen.has(resolvedPath)) {
            seen.add(resolvedPath);
            results.push({ path: resolvedPath, isDynamic: false });
        }
    }

    // Process relative imports first (they also match FROM_IMPORT_PATTERN,
    // so we collect them in a set to avoid duplicate processing).
    const relativeModules = new Set<string>();
    let match: RegExpExecArray | null;

    RELATIVE_IMPORT_PATTERN.lastIndex = 0;
    while ((match = RELATIVE_IMPORT_PATTERN.exec(content)) !== null) {
        const modulePath = match[1];
        relativeModules.add(modulePath);
        const resolved = resolveRelativeImport(filePath, modulePath);
        if (resolved) {
            addResult(resolved);
        }
    }

    // Process `from module import name` (absolute only; skip relative ones
    // already handled above).
    FROM_IMPORT_PATTERN.lastIndex = 0;
    while ((match = FROM_IMPORT_PATTERN.exec(content)) !== null) {
        const modulePath = match[1];
        if (modulePath.startsWith('.')) {
            continue;
        }
        const resolved = resolveAbsoluteImport(modulePath, projectRoot);
        if (resolved) {
            addResult(resolved);
        }
    }

    // Process `import module_name`
    IMPORT_PATTERN.lastIndex = 0;
    while ((match = IMPORT_PATTERN.exec(content)) !== null) {
        const modulePath = match[1];
        const resolved = resolveAbsoluteImport(modulePath, projectRoot);
        if (resolved) {
            addResult(resolved);
        }
    }

    return results;
}
