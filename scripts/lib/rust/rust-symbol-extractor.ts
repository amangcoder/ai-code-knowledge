import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Top-level declarations
const STRUCT_RE = /^(?:pub(?:\(crate\))?\s+)?struct\s+(\w+)(?:<[^>]*>)?/;
const TRAIT_RE = /^(?:pub(?:\(crate\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)(?:<[^>]*>)?/;
const ENUM_RE = /^(?:pub(?:\(crate\))?\s+)?enum\s+(\w+)(?:<[^>]*>)?/;
const TYPE_ALIAS_RE = /^(?:pub(?:\(crate\))?\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/;

// Function declarations
const FN_RE = /^(?:pub(?:\(crate\))?\s+)?(?:(?:unsafe|async|const|extern\s+"[^"]*")\s+)*fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([\w<>&\[\], :!?']+))?/;

// impl blocks
const IMPL_RE = /^(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:(\w+)(?:<[^>]*>)?\s+for\s+)?(\w+)(?:<[^>]*>)?\s*(?:where\s+[^{]*)?\{/;

// Macro definitions
const MACRO_RE = /^(?:pub(?:\(crate\))?\s+)?macro_rules!\s+(\w+)/;

// Attribute macros (#[derive(...)])
const ATTR_RE = /^\s*#\[(\w+(?:\([^)]*\))?)\]/;

// Rust keywords
const RUST_KEYWORDS = new Set([
    'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
    'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
    'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
    'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
    'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final',
    'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield',
]);

/**
 * Count net brace depth change on a single line.
 */
function netBraces(line: string): number {
    let depth = 0;
    let inString = false;
    let inChar = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && (inString || inChar)) {
            i += 2;
            continue;
        }
        if (ch === '"' && !inChar) { inString = !inString; }
        else if (ch === '\'' && !inString) {
            // Distinguish char literal from lifetime annotation
            // Lifetimes: 'a, 'static, etc. — never followed by closing '
            if (!inChar && i + 2 < line.length && line[i + 2] === '\'') {
                inChar = true;
            } else if (inChar) {
                inChar = false;
            }
            // else: lifetime, skip
        }
        else if (!inString && !inChar) {
            if (ch === '/' && line[i + 1] === '/') break;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        i++;
    }
    return depth;
}

/**
 * Regex-based Rust symbol extractor.
 * Uses brace-depth tracking for impl blocks.
 */
export function extractRustSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const moduleName = path.basename(path.dirname(filePath));

    const lines = content.split('\n');
    let braceDepth = 0;

    // Track impl blocks: { implType, traitName?, depth }
    const implStack: Array<{ implType: string; traitName: string | null; depth: number }> = [];
    let attrBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            braceDepth += netBraces(line);
            continue;
        }

        const depthBefore = braceDepth;
        braceDepth += netBraces(line);

        // Pop impl blocks that have ended
        while (implStack.length > 0 && braceDepth <= implStack[implStack.length - 1].depth) {
            implStack.pop();
        }

        // Collect attributes
        const attrMatch = trimmed.match(ATTR_RE);
        if (attrMatch && /^\s*#\[.*\]\s*$/.test(trimmed)) {
            attrBuffer.push(attrMatch[1]);
            continue;
        }

        const currentImpl = implStack.length > 0 ? implStack[implStack.length - 1] : null;
        const isPub = (s: string) => s.startsWith('pub');

        // Top-level declarations (depth 0)
        if (depthBefore === 0) {
            // Struct
            const structMatch = trimmed.match(STRUCT_RE);
            if (structMatch) {
                const name = structMatch[1];
                symbols.push(makeSymbol(name, name, 'class', relativePath, lineNumber,
                    trimmed.replace(/\s*\{.*$/, '').replace(/;.*$/, '').trim(),
                    moduleName, isPub(trimmed), attrBuffer));
                attrBuffer = [];
                continue;
            }

            // Trait
            const traitMatch = trimmed.match(TRAIT_RE);
            if (traitMatch) {
                const name = traitMatch[1];
                symbols.push(makeSymbol(name, name, 'interface', relativePath, lineNumber,
                    trimmed.replace(/\s*\{.*$/, '').trim(),
                    moduleName, isPub(trimmed), attrBuffer));
                attrBuffer = [];
                continue;
            }

            // Enum
            const enumMatch = trimmed.match(ENUM_RE);
            if (enumMatch) {
                const name = enumMatch[1];
                symbols.push(makeSymbol(name, name, 'enum', relativePath, lineNumber,
                    trimmed.replace(/\s*\{.*$/, '').trim(),
                    moduleName, isPub(trimmed), attrBuffer));
                attrBuffer = [];
                continue;
            }

            // Type alias
            const typeMatch = trimmed.match(TYPE_ALIAS_RE);
            if (typeMatch) {
                const name = typeMatch[1];
                symbols.push(makeSymbol(name, name, 'type', relativePath, lineNumber,
                    trimmed.replace(/;\s*$/, '').trim(),
                    moduleName, isPub(trimmed), attrBuffer));
                attrBuffer = [];
                continue;
            }

            // Macro
            const macroMatch = trimmed.match(MACRO_RE);
            if (macroMatch) {
                const name = macroMatch[1];
                symbols.push(makeSymbol(name, name, 'function', relativePath, lineNumber,
                    `macro_rules! ${name}`, moduleName, true, attrBuffer));
                attrBuffer = [];
                continue;
            }

            // Top-level function
            const fnMatch = trimmed.match(FN_RE);
            if (fnMatch && !RUST_KEYWORDS.has(fnMatch[1])) {
                const name = fnMatch[1];
                const params = fnMatch[2].trim();
                const returnType = fnMatch[3]?.trim() || '';
                const isAsync = trimmed.includes('async ');
                let sig = `fn ${name}(${params})`;
                if (returnType) sig += ` -> ${returnType}`;
                if (isPub(trimmed)) sig = `pub ${sig}`;
                symbols.push(makeSymbol(name, name, 'function', relativePath, lineNumber,
                    sig, moduleName, isPub(trimmed), attrBuffer, undefined, isAsync));
                attrBuffer = [];
                continue;
            }

            // Impl block
            const implMatch = trimmed.match(IMPL_RE);
            if (implMatch) {
                const traitName = implMatch[1] || null;
                const implType = implMatch[2];
                implStack.push({ implType, traitName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }
        }

        // Methods inside impl blocks (depth 1)
        if (currentImpl && depthBefore === 1) {
            const fnMatch = trimmed.match(FN_RE);
            if (fnMatch && !RUST_KEYWORDS.has(fnMatch[1])) {
                const name = fnMatch[1];
                const params = fnMatch[2].trim();
                const returnType = fnMatch[3]?.trim() || '';
                const isAsync = trimmed.includes('async ');

                // Heuristic: fn new(...) -> Self is a constructor
                const isConstructor = name === 'new' && (returnType === 'Self' || returnType.startsWith('Self'));
                const hasSelf = params.startsWith('&self') || params.startsWith('&mut self') || params.startsWith('self');

                let sig = `fn ${name}(${params})`;
                if (returnType) sig += ` -> ${returnType}`;
                if (isPub(trimmed)) sig = `pub ${sig}`;

                const type: SymbolEntry['type'] = isConstructor ? 'constructor' : hasSelf ? 'method' : 'method';
                const qualifiedName = `${currentImpl.implType}.${name}`;

                symbols.push(makeSymbol(name, qualifiedName, type, relativePath, lineNumber,
                    sig, moduleName, isPub(trimmed), attrBuffer, undefined, isAsync));
                attrBuffer = [];
                continue;
            }
        }

        // Clear attribute buffer on non-matching lines
        if (!trimmed.match(ATTR_RE)) {
            attrBuffer = [];
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
    isExported: boolean,
    decorators?: string[],
    accessModifier?: string,
    isAsync?: boolean,
): SymbolEntry {
    return {
        name, qualifiedName, file, line, signature, type, module,
        calls: [], calledBy: [], throws: [],
        isExported, language: 'rust',
        ...(decorators && decorators.length > 0 && { decorators }),
        ...(accessModifier && { accessModifier }),
        ...(isAsync && { isAsync }),
    };
}
