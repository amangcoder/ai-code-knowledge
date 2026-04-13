import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// Single import: import "fmt"
const SINGLE_IMPORT_RE = /^import\s+"([^"]+)"/gm;
// Block import: import ( ... )
const BLOCK_IMPORT_RE = /^import\s*\(([\s\S]*?)\)/gm;
// Individual line inside a block import
const BLOCK_LINE_RE = /^\s*(?:\w+\s+)?"([^"]+)"/;

/**
 * Reads the module path from go.mod to determine which imports are local.
 */
function readModulePath(projectRoot: string): string | null {
    const goMod = path.join(projectRoot, 'go.mod');
    if (!fs.existsSync(goMod)) return null;
    const content = fs.readFileSync(goMod, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    return match ? match[1] : null;
}

/**
 * Resolves a Go import path to a local directory.
 * Returns null for stdlib and external imports.
 */
function resolveGoImport(
    importPath: string,
    modulePath: string,
    projectRoot: string
): string | null {
    // Only resolve imports that start with the module path (local packages)
    if (!importPath.startsWith(modulePath)) return null;

    const localPath = importPath.slice(modulePath.length);
    const dir = path.join(projectRoot, localPath);

    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        // Return the directory path — Go packages are directory-based
        return dir;
    }
    return null;
}

/**
 * Extracts Go import dependencies from a source file.
 * Resolves local package imports to absolute directory paths.
 * Ignores stdlib and external module imports.
 */
export function extractGoDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const modulePath = readModulePath(projectRoot);
    if (!modulePath) return [];

    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    function addResult(resolvedPath: string): void {
        if (!seen.has(resolvedPath)) {
            seen.add(resolvedPath);
            results.push({ path: resolvedPath, isDynamic: false });
        }
    }

    // Single-line imports
    let match: RegExpExecArray | null;
    SINGLE_IMPORT_RE.lastIndex = 0;
    while ((match = SINGLE_IMPORT_RE.exec(content)) !== null) {
        const resolved = resolveGoImport(match[1], modulePath, projectRoot);
        if (resolved) addResult(resolved);
    }

    // Block imports
    BLOCK_IMPORT_RE.lastIndex = 0;
    while ((match = BLOCK_IMPORT_RE.exec(content)) !== null) {
        const block = match[1];
        for (const line of block.split('\n')) {
            const lineMatch = line.match(BLOCK_LINE_RE);
            if (lineMatch) {
                const resolved = resolveGoImport(lineMatch[1], modulePath, projectRoot);
                if (resolved) addResult(resolved);
            }
        }
    }

    return results;
}
