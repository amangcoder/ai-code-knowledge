import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// import com.example.MyClass;
// import com.example.*;
// import static com.example.MyClass.method;
const IMPORT_RE = /^import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
const PACKAGE_RE = /^package\s+([\w.]+)\s*;/m;

/**
 * Finds the source root directory (e.g., src/main/java/) by walking up from the file
 * and checking if the path matches the package structure.
 */
function findSourceRoot(filePath: string, packageName: string): string | null {
    const packagePath = packageName.replace(/\./g, path.sep);
    const fileDir = path.dirname(filePath);

    if (fileDir.endsWith(packagePath)) {
        return fileDir.slice(0, -packagePath.length);
    }
    return null;
}

/**
 * Resolves a Java import to a local file path.
 * Returns null for external/unresolvable imports.
 */
function resolveJavaImport(
    importPath: string,
    sourceRoot: string | null,
    projectRoot: string
): string | null {
    // Wildcard imports can't be resolved to a single file
    if (importPath.endsWith('.*')) return null;

    // Strip static method part (take only the class path)
    // e.g., com.example.MyClass.method → com.example.MyClass
    const segments = importPath.split('.');
    // Find the class name (first segment starting with uppercase)
    let classEndIdx = segments.length;
    for (let i = 0; i < segments.length; i++) {
        if (segments[i][0] === segments[i][0].toUpperCase() && segments[i][0] !== segments[i][0].toLowerCase()) {
            classEndIdx = i + 1;
            break;
        }
    }
    const classPath = segments.slice(0, classEndIdx).join(path.sep) + '.java';

    // Try source root first
    if (sourceRoot) {
        const resolved = path.join(sourceRoot, classPath);
        if (fs.existsSync(resolved)) return resolved;
    }

    // Try common Java source directories
    const commonRoots = [
        'src/main/java',
        'src',
        'src/main/kotlin', // Kotlin/Java mixed projects
        'app/src/main/java',
    ];

    for (const root of commonRoots) {
        const resolved = path.join(projectRoot, root, classPath);
        if (fs.existsSync(resolved)) return resolved;
    }

    return null;
}

/**
 * Extracts Java import dependencies from a source file.
 * Resolves local imports to absolute file paths.
 * Ignores external library imports that can't be resolved.
 */
export function extractJavaDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    // Detect package name and derive source root
    const packageMatch = content.match(PACKAGE_RE);
    const packageName = packageMatch ? packageMatch[1] : '';
    const sourceRoot = packageName ? findSourceRoot(filePath, packageName) : null;

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;

    while ((match = IMPORT_RE.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveJavaImport(importPath, sourceRoot, projectRoot);
        if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            results.push({ path: resolved, isDynamic: false });
        }
    }

    return results;
}
