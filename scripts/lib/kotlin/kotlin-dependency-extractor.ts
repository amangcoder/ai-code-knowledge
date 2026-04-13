import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// import com.example.MyClass
// import com.example.MyClass as Alias
const IMPORT_RE = /^import\s+([\w.]+)(?:\s+as\s+\w+)?\s*$/gm;
const PACKAGE_RE = /^package\s+([\w.]+)\s*$/m;

/**
 * Finds the source root directory by matching the package structure.
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
 * Resolves a Kotlin import to a local file path.
 */
function resolveKotlinImport(
    importPath: string,
    sourceRoot: string | null,
    projectRoot: string
): string | null {
    // Kotlin imports can reference classes, functions, or properties.
    // We try to find a matching .kt or .java file.
    const segments = importPath.split('.');

    // Find the class name (first uppercase segment)
    let classEndIdx = segments.length;
    for (let i = 0; i < segments.length; i++) {
        if (segments[i][0] === segments[i][0].toUpperCase() && segments[i][0] !== segments[i][0].toLowerCase()) {
            classEndIdx = i + 1;
            break;
        }
    }

    const classPath = segments.slice(0, classEndIdx).join(path.sep);

    const commonRoots = sourceRoot
        ? [sourceRoot]
        : [];
    commonRoots.push(
        path.join(projectRoot, 'src/main/kotlin'),
        path.join(projectRoot, 'src/main/java'),
        path.join(projectRoot, 'src'),
        path.join(projectRoot, 'app/src/main/kotlin'),
        path.join(projectRoot, 'app/src/main/java'),
    );

    for (const root of commonRoots) {
        // Try .kt first, then .java
        const ktPath = path.join(root, classPath + '.kt');
        if (fs.existsSync(ktPath)) return ktPath;
        const javaPath = path.join(root, classPath + '.java');
        if (fs.existsSync(javaPath)) return javaPath;
    }

    return null;
}

/**
 * Extracts Kotlin import dependencies from a source file.
 */
export function extractKotlinDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    const packageMatch = content.match(PACKAGE_RE);
    const packageName = packageMatch ? packageMatch[1] : '';
    const sourceRoot = packageName ? findSourceRoot(filePath, packageName) : null;

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;

    while ((match = IMPORT_RE.exec(content)) !== null) {
        const importPath = match[1];
        // Skip kotlin stdlib and android imports
        if (importPath.startsWith('kotlin.') || importPath.startsWith('java.') ||
            importPath.startsWith('javax.') || importPath.startsWith('android.') ||
            importPath.startsWith('androidx.') || importPath.startsWith('kotlinx.')) {
            continue;
        }
        const resolved = resolveKotlinImport(importPath, sourceRoot, projectRoot);
        if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            results.push({ path: resolved, isDynamic: false });
        }
    }

    return results;
}
