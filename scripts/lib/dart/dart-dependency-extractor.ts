import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// Matches: import 'some/path.dart'; or import 'some/path.dart' show Foo;
// Also handles export 'some/path.dart';
const IMPORT_RE = /^(?:import|export)\s+['"]([^'"]+)['"]/gm;

function tryResolve(dartPath: string): string | null {
    if (fs.existsSync(dartPath)) return dartPath;
    return null;
}

/**
 * Resolves a Dart import path to an absolute file path.
 * Returns null for dart: SDK imports and package: external imports.
 */
function resolveDartImport(
    importPath: string,
    filePath: string,
    projectRoot: string
): string | null {
    // dart: and package: imports cannot be resolved to local files without pub cache
    if (importPath.startsWith('dart:')) return null;

    if (importPath.startsWith('package:')) {
        // Strip package:pkg_name/ prefix and look in the project lib/ folder
        // e.g., package:my_app/src/foo.dart → <projectRoot>/lib/src/foo.dart
        const withoutPackage = importPath.slice('package:'.length);
        const slashIdx = withoutPackage.indexOf('/');
        if (slashIdx === -1) return null;
        const localPath = withoutPackage.slice(slashIdx + 1); // e.g., src/foo.dart
        const resolved = path.join(projectRoot, 'lib', localPath);
        return tryResolve(resolved);
    }

    // Relative import: resolve relative to the importing file's directory
    const fileDir = path.dirname(filePath);
    const resolved = path.resolve(fileDir, importPath);
    return tryResolve(resolved);
}

/**
 * Extracts Dart import/export dependencies from a source file.
 * Resolves relative and same-package imports to absolute paths.
 * Ignores dart: SDK and unresolvable external package: imports.
 */
export function extractDartDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;

    while ((match = IMPORT_RE.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveDartImport(importPath, filePath, projectRoot);
        if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            results.push({ path: resolved, isDynamic: false });
        }
    }

    return results;
}
