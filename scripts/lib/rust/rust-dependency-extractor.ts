import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ImportInfo } from '../dependency-extractor.js';

// use crate::module::item;
// use crate::module::{item1, item2};
// use super::module::item;
// use self::module::item;
const USE_CRATE_RE = /^use\s+crate::([^;]+);/gm;
const USE_SUPER_RE = /^use\s+super::([^;]+);/gm;
const USE_SELF_RE = /^use\s+self::([^;]+);/gm;

// mod declarations: mod name;
const MOD_DECL_RE = /^(?:pub(?:\(crate\))?\s+)?mod\s+(\w+)\s*;/gm;

/**
 * Resolves a mod name to a file path.
 * In Rust, `mod foo;` resolves to either `foo.rs` or `foo/mod.rs`.
 */
function resolveModDecl(modName: string, filePath: string): string | null {
    const fileDir = path.dirname(filePath);
    const fileName = path.basename(filePath, '.rs');

    // If we're in a mod.rs or lib.rs/main.rs, submodules are siblings
    let baseDir: string;
    if (fileName === 'mod' || fileName === 'lib' || fileName === 'main') {
        baseDir = fileDir;
    } else {
        // e.g., for foo.rs, submodules are in foo/
        baseDir = path.join(fileDir, fileName);
    }

    // Try name.rs first, then name/mod.rs
    const asFile = path.join(baseDir, `${modName}.rs`);
    if (fs.existsSync(asFile)) return asFile;

    const asMod = path.join(baseDir, modName, 'mod.rs');
    if (fs.existsSync(asMod)) return asMod;

    return null;
}

/**
 * Resolves a crate-relative use path to a file path.
 * e.g., crate::models::user → src/models/user.rs or src/models/user/mod.rs
 */
function resolveCrateUse(usePath: string, projectRoot: string): string | null {
    // Extract the module path (before :: { ... } or :: item)
    const segments = usePath.split('::');
    // Remove the last segment if it looks like an item (starts with uppercase or is *)
    // or if it contains braces
    let modulePath = segments;
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.includes('{') || lastSeg === '*' ||
        (lastSeg[0] === lastSeg[0].toUpperCase() && lastSeg[0] !== lastSeg[0].toLowerCase())) {
        modulePath = segments.slice(0, -1);
    }

    if (modulePath.length === 0) return null;

    const srcDir = path.join(projectRoot, 'src');
    const relPath = modulePath.join(path.sep);

    // Try as file
    const asFile = path.join(srcDir, relPath + '.rs');
    if (fs.existsSync(asFile)) return asFile;

    // Try as directory with mod.rs
    const asMod = path.join(srcDir, relPath, 'mod.rs');
    if (fs.existsSync(asMod)) return asMod;

    return null;
}

/**
 * Resolves a super:: or self:: use path.
 */
function resolveRelativeUse(
    usePath: string,
    filePath: string,
    prefix: 'super' | 'self'
): string | null {
    const fileDir = path.dirname(filePath);
    const baseDir = prefix === 'super' ? path.dirname(fileDir) : fileDir;

    const segments = usePath.split('::');
    let modulePath = segments;
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.includes('{') || lastSeg === '*' ||
        (lastSeg[0] === lastSeg[0].toUpperCase() && lastSeg[0] !== lastSeg[0].toLowerCase())) {
        modulePath = segments.slice(0, -1);
    }

    if (modulePath.length === 0) return null;

    const relPath = modulePath.join(path.sep);
    const asFile = path.join(baseDir, relPath + '.rs');
    if (fs.existsSync(asFile)) return asFile;

    const asMod = path.join(baseDir, relPath, 'mod.rs');
    if (fs.existsSync(asMod)) return asMod;

    return null;
}

/**
 * Extracts Rust import dependencies from a source file.
 * Resolves crate-local, super, and self use paths and mod declarations.
 * Ignores external crate imports.
 */
export function extractRustDeps(
    filePath: string,
    content: string,
    projectRoot: string
): ImportInfo[] {
    const seen = new Set<string>();
    const results: ImportInfo[] = [];

    function addResult(resolvedPath: string): void {
        if (!seen.has(resolvedPath)) {
            seen.add(resolvedPath);
            results.push({ path: resolvedPath, isDynamic: false });
        }
    }

    let match: RegExpExecArray | null;

    // use crate::...
    USE_CRATE_RE.lastIndex = 0;
    while ((match = USE_CRATE_RE.exec(content)) !== null) {
        const resolved = resolveCrateUse(match[1].trim(), projectRoot);
        if (resolved) addResult(resolved);
    }

    // use super::...
    USE_SUPER_RE.lastIndex = 0;
    while ((match = USE_SUPER_RE.exec(content)) !== null) {
        const resolved = resolveRelativeUse(match[1].trim(), filePath, 'super');
        if (resolved) addResult(resolved);
    }

    // use self::...
    USE_SELF_RE.lastIndex = 0;
    while ((match = USE_SELF_RE.exec(content)) !== null) {
        const resolved = resolveRelativeUse(match[1].trim(), filePath, 'self');
        if (resolved) addResult(resolved);
    }

    // mod declarations
    MOD_DECL_RE.lastIndex = 0;
    while ((match = MOD_DECL_RE.exec(content)) !== null) {
        const modName = match[1];
        const resolved = resolveModDecl(modName, filePath);
        if (resolved) addResult(resolved);
    }

    return results;
}
