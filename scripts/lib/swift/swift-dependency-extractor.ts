import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// import Foundation
// import UIKit
// @testable import MyModule
const IMPORT_RE = /^(?:@testable\s+)?import\s+(\w+)/gm;

/**
 * Swift does not have file-level imports for local code — all files
 * in the same module/target are implicitly visible to each other.
 *
 * Framework/module imports (Foundation, UIKit, etc.) are external and
 * cannot be resolved to local files.
 *
 * For local dependency tracking, we scan for all .swift files in the
 * same directory (and subdirectories if in the same SPM target) and
 * treat them as implicit dependencies.
 */

/**
 * Finds all .swift files in the same source directory as the given file.
 * This approximates the "same module" relationship for dependency tracking.
 */
function findSiblingSwiftFiles(
    filePath: string,
    projectRoot: string
): string[] {
    const fileDir = path.dirname(filePath);
    const siblings: string[] = [];

    // Find the source root — common patterns: Sources/ModuleName/, src/
    // Walk up from fileDir to find a known source root pattern
    let sourceRoot = fileDir;
    const relToProject = path.relative(projectRoot, fileDir);
    const parts = relToProject.split(path.sep);

    // For SPM: Sources/ModuleName/...
    // For Xcode: ProjectName/...
    if (parts[0] === 'Sources' && parts.length >= 2) {
        sourceRoot = path.join(projectRoot, parts[0], parts[1]);
    }

    // Only scan sibling files in the same directory (not recursive)
    // to keep dependency graph manageable
    try {
        const entries = fs.readdirSync(fileDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.swift')) {
                const siblingPath = path.join(fileDir, entry.name);
                if (siblingPath !== filePath) {
                    siblings.push(siblingPath);
                }
            }
        }
    } catch {
        // Directory might not exist or be unreadable
    }

    return siblings;
}

/**
 * Extracts Swift import dependencies from a source file.
 * Since Swift doesn't have file-level imports for local code,
 * this returns sibling .swift files as implicit dependencies
 * and ignores external framework imports.
 */
export function extractSwiftDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const results: ImportInfo[] = [];
    const seen = new Set<string>();

    // Add sibling swift files as implicit dependencies
    const siblings = findSiblingSwiftFiles(filePath, projectRoot);
    for (const sibling of siblings) {
        if (!seen.has(sibling)) {
            seen.add(sibling);
            results.push({ path: sibling, isDynamic: false });
        }
    }

    return results;
}
