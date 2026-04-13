import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Top-level structural declarations
const CLASS_RE = /^(?:(?:abstract|final|sealed|base|interface)\s+)?class\s+(\w+)/;
const MIXIN_RE = /^mixin\s+(\w+)/;
const ENUM_RE = /^enum\s+(\w+)/;
const EXTENSION_RE = /^extension(?:\s+(\w+))?\s+on\s+/;
const TYPEDEF_RE = /^typedef\s+(\w+)/;

// Function/method declaration patterns (applied to trimmed lines)
const GETTER_RE = /^(?:(?:static|override|external|abstract)\s+)*(?:[\w<>\[\]?.]+\s+)+get\s+(\w+)\s*(?:\{|=>)/;
const SETTER_RE = /^(?:(?:static|override)\s+)*(?:[\w<>\[\]?.]+\s+)+set\s+(\w+)\s*\(/;
// Generic function/method: optional modifiers + return type(s) + name + (
const FUNC_RE = /^(?:(?:static|override|external|abstract|const|factory)\s+)*(?:[\w<>\[\]?.]+\s+)+(\w+)\s*(?:<[^>]*>)?\s*\(/;

// Dart keywords that must not be matched as function names
const DART_KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'return', 'throw', 'try', 'catch', 'finally', 'new', 'const', 'final',
    'var', 'late', 'static', 'abstract', 'class', 'extends', 'implements',
    'with', 'mixin', 'enum', 'import', 'export', 'library', 'part', 'as',
    'assert', 'await', 'async', 'yield', 'super', 'this', 'true', 'false',
    'null', 'void', 'dynamic', 'typedef', 'external', 'factory', 'operator',
    'get', 'set', 'in', 'is', 'rethrow', 'on', 'show', 'hide', 'required',
    'covariant', 'sealed', 'base', 'interface', 'override', 'when',
]);

/**
 * Count net brace depth change on a single line, ignoring braces inside
 * string literals and single-line comments.
 */
function netBraces(line: string): number {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && (inSingle || inDouble)) {
            i += 2;
            continue;
        }
        if (ch === "'" && !inDouble) { inSingle = !inSingle; }
        else if (ch === '"' && !inSingle) { inDouble = !inDouble; }
        else if (!inSingle && !inDouble) {
            if (ch === '/' && line[i + 1] === '/') break; // line comment
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        i++;
    }
    return depth;
}

/**
 * Returns true if the trimmed line looks like a function/method declaration
 * (must end with `{`, `=>`, `;`, or `async {`).
 */
function looksLikeFuncDecl(trimmed: string): boolean {
    return /\)\s*(?:async\s*)?(?:\*\s*)?(?:\{|=>)\s*$/.test(trimmed) ||
        /\)\s*;\s*$/.test(trimmed); // abstract/external methods end with ;
}

/**
 * Regex-based Dart symbol extractor.
 * Uses brace-depth tracking to distinguish top-level and class-member declarations.
 */
export function extractDartSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const moduleName = path.basename(path.dirname(filePath));

    const lines = content.split('\n');
    let braceDepth = 0;

    // Stack of structural containers: class/mixin/extension names (or null for extension without name)
    const containerStack: Array<{ name: string | null; depth: number }> = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmed = line.trim();

        if (trimmed === '') {
            continue;
        }

        // Skip single-line comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            braceDepth += netBraces(line);
            continue;
        }

        const depthBefore = braceDepth;
        braceDepth += netBraces(line);

        // Pop containers whose depth exceeds current brace depth
        while (containerStack.length > 0 && braceDepth <= containerStack[containerStack.length - 1].depth) {
            containerStack.pop();
        }

        const currentContainer = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
        const insideClass = currentContainer !== null;

        // --- Detect structural declarations at any depth (class inside class is uncommon but valid) ---
        if (depthBefore === 0 || depthBefore === containerStack.length) {
            // Class
            const classMatch = trimmed.match(CLASS_RE);
            if (classMatch && depthBefore === 0) {
                const name = classMatch[1];
                const modifiers = trimmed.match(/^((?:abstract|final|sealed|base|interface)\s+)?/)?.[1]?.trim() ?? '';
                const extendsMatch = trimmed.match(/extends\s+([\w<>, .]+?)(?:\s+(?:with|implements)\s|$|\{)/);
                const bases = extendsMatch ? extendsMatch[1].trim() : '';
                const signature = modifiers
                    ? `${modifiers} class ${name}${bases ? ` extends ${bases}` : ''}`
                    : `class ${name}${bases ? ` extends ${bases}` : ''}`;
                symbols.push(makeSymbol(name, name, 'class', relativePath, lineNumber, signature, moduleName, true));
                containerStack.push({ name, depth: depthBefore });
                continue;
            }

            // Mixin
            const mixinMatch = trimmed.match(MIXIN_RE);
            if (mixinMatch && depthBefore === 0) {
                const name = mixinMatch[1];
                symbols.push(makeSymbol(name, name, 'class', relativePath, lineNumber, `mixin ${name}`, moduleName, true));
                containerStack.push({ name, depth: depthBefore });
                continue;
            }

            // Enum
            const enumMatch = trimmed.match(ENUM_RE);
            if (enumMatch && depthBefore === 0) {
                const name = enumMatch[1];
                symbols.push(makeSymbol(name, name, 'enum', relativePath, lineNumber, `enum ${name}`, moduleName, true));
                containerStack.push({ name, depth: depthBefore });
                continue;
            }

            // Extension
            const extMatch = trimmed.match(EXTENSION_RE);
            if (extMatch && depthBefore === 0) {
                const extName = extMatch[1] ?? null;
                if (extName) {
                    const onType = trimmed.match(/on\s+([\w<>?, .]+?)\s*\{/)?.[1]?.trim() ?? '';
                    symbols.push(makeSymbol(extName, extName, 'class', relativePath, lineNumber, `extension ${extName} on ${onType}`, moduleName, true));
                }
                containerStack.push({ name: extName, depth: depthBefore });
                continue;
            }
        }

        // Typedef (can appear at depth 0)
        if (depthBefore === 0) {
            const typedefMatch = trimmed.match(TYPEDEF_RE);
            if (typedefMatch) {
                const name = typedefMatch[1];
                symbols.push(makeSymbol(name, name, 'type', relativePath, lineNumber, trimmed.replace(/;\s*$/, ''), moduleName, true));
                continue;
            }
        }

        // --- Detect functions/methods ---
        // At depth 0: top-level functions
        // At depth 1 inside a class/mixin/extension: methods
        const isTopLevel = depthBefore === 0;
        const isClassMember = insideClass && depthBefore === containerStack.length;

        if (isTopLevel || isClassMember) {
            const className = currentContainer?.name ?? null;

            // Getter
            const getterMatch = trimmed.match(GETTER_RE);
            if (getterMatch) {
                const name = getterMatch[1];
                if (!DART_KEYWORDS.has(name)) {
                    const qualifiedName = className ? `${className}.${name}` : name;
                    const sig = trimmed.replace(/\s*(?:\{|=>).*$/, '').trim();
                    symbols.push(makeSymbol(name, qualifiedName, 'property', relativePath, lineNumber, sig, moduleName, !name.startsWith('_')));
                    continue;
                }
            }

            // Setter
            const setterMatch = trimmed.match(SETTER_RE);
            if (setterMatch) {
                const name = setterMatch[1];
                if (!DART_KEYWORDS.has(name)) {
                    const qualifiedName = className ? `${className}.${name}` : name;
                    const sig = trimmed.replace(/\s*\(.*$/, '').trim();
                    symbols.push(makeSymbol(name, qualifiedName, 'property', relativePath, lineNumber, sig, moduleName, !name.startsWith('_')));
                    continue;
                }
            }

            // Function/method
            if (looksLikeFuncDecl(trimmed)) {
                const funcMatch = trimmed.match(FUNC_RE);
                if (funcMatch) {
                    const name = funcMatch[1];
                    if (!DART_KEYWORDS.has(name)) {
                        const qualifiedName = className ? `${className}.${name}` : name;
                        // Extract signature up to the closing )
                        const parenEnd = trimmed.indexOf(')');
                        const sig = parenEnd !== -1
                            ? trimmed.slice(0, parenEnd + 1).trim()
                            : trimmed.split('{')[0].trim();
                        const kind = className ? 'method' : 'function';
                        symbols.push(makeSymbol(name, qualifiedName, kind, relativePath, lineNumber, sig, moduleName, !name.startsWith('_')));
                        continue;
                    }
                }
            }
        }
    }

    return symbols;
}

function makeSymbol(
    name: string,
    qualifiedName: string,
    type: SymbolEntry['type'],
    file: string,
    line: number,
    signature: string,
    module: string,
    isExported: boolean
): SymbolEntry {
    return {
        name,
        qualifiedName,
        file,
        line,
        signature,
        type,
        module,
        calls: [],
        calledBy: [],
        throws: [],
        isExported,
        language: 'dart',
    };
}
