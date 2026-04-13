import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Top-level type declarations
const STRUCT_RE = /^type\s+(\w+)\s+struct\s*\{/;
const INTERFACE_RE = /^type\s+(\w+)\s+interface\s*\{/;
const TYPE_ALIAS_RE = /^type\s+(\w+)\s+(?!struct|interface)(\S.*)/;

// Function declarations
const FUNC_RE = /^func\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(.*)$/;
// Method declarations: func (receiver ReceiverType) MethodName(...)
const METHOD_RE = /^func\s+\((\w+)\s+\*?(\w+)(?:<[^>]*>)?\)\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(.*)$/;

/**
 * In Go, exported symbols start with an uppercase letter.
 */
function isGoExported(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

/**
 * Extract return type from the remainder after params.
 * e.g., " (int, error) {" → "(int, error)"
 * e.g., " error {" → "error"
 */
function extractReturnType(remainder: string): string {
    const trimmed = remainder.replace(/\s*\{.*$/, '').trim();
    return trimmed || '';
}

/**
 * Regex-based Go symbol extractor.
 * Uses brace-depth tracking to distinguish top-level declarations from method bodies.
 */
export function extractGoSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const moduleName = path.basename(path.dirname(filePath));

    const lines = content.split('\n');
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
            braceDepth += netBraces(line);
            continue;
        }

        const depthBefore = braceDepth;
        braceDepth += netBraces(line);

        // Only extract top-level declarations (depth 0)
        if (depthBefore !== 0) continue;

        // Method: func (r *Type) Name(...)
        const methodMatch = trimmed.match(METHOD_RE);
        if (methodMatch) {
            const receiverType = methodMatch[2];
            const methodName = methodMatch[3];
            const params = methodMatch[4].trim();
            const returnType = extractReturnType(methodMatch[5]);
            const sig = returnType
                ? `func (${receiverType}) ${methodName}(${params}) ${returnType}`
                : `func (${receiverType}) ${methodName}(${params})`;
            symbols.push(makeSymbol(
                methodName,
                `${receiverType}.${methodName}`,
                'method',
                relativePath, lineNumber, sig, moduleName,
                isGoExported(methodName),
            ));
            continue;
        }

        // Function: func Name(...)
        const funcMatch = trimmed.match(FUNC_RE);
        if (funcMatch) {
            const funcName = funcMatch[1];
            const params = funcMatch[2].trim();
            const returnType = extractReturnType(funcMatch[3]);

            // init() is a special module initializer
            const type: SymbolEntry['type'] = funcName === 'init' ? 'module-init' : 'function';

            const sig = returnType
                ? `func ${funcName}(${params}) ${returnType}`
                : `func ${funcName}(${params})`;
            symbols.push(makeSymbol(
                funcName,
                funcName,
                type,
                relativePath, lineNumber, sig, moduleName,
                isGoExported(funcName),
            ));
            continue;
        }

        // Struct
        const structMatch = trimmed.match(STRUCT_RE);
        if (structMatch) {
            const name = structMatch[1];
            symbols.push(makeSymbol(
                name, name, 'class',
                relativePath, lineNumber, `type ${name} struct`,
                moduleName, isGoExported(name),
            ));
            continue;
        }

        // Interface
        const interfaceMatch = trimmed.match(INTERFACE_RE);
        if (interfaceMatch) {
            const name = interfaceMatch[1];
            symbols.push(makeSymbol(
                name, name, 'interface',
                relativePath, lineNumber, `type ${name} interface`,
                moduleName, isGoExported(name),
            ));
            continue;
        }

        // Type alias / named type
        const typeMatch = trimmed.match(TYPE_ALIAS_RE);
        if (typeMatch) {
            const name = typeMatch[1];
            const underlying = typeMatch[2].replace(/\s*$/, '');
            symbols.push(makeSymbol(
                name, name, 'type',
                relativePath, lineNumber, `type ${name} ${underlying}`,
                moduleName, isGoExported(name),
            ));
            continue;
        }
    }

    return symbols;
}

/**
 * Count net brace depth change on a single line,
 * ignoring braces inside string literals and comments.
 */
function netBraces(line: string): number {
    let depth = 0;
    let inString = false;
    let inRune = false;
    let inBacktick = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && (inString || inRune)) {
            i += 2;
            continue;
        }
        if (ch === '"' && !inRune && !inBacktick) { inString = !inString; }
        else if (ch === '\'' && !inString && !inBacktick) { inRune = !inRune; }
        else if (ch === '`' && !inString && !inRune) { inBacktick = !inBacktick; }
        else if (!inString && !inRune && !inBacktick) {
            if (ch === '/' && line[i + 1] === '/') break;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        i++;
    }
    return depth;
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
): SymbolEntry {
    return {
        name, qualifiedName, file, line, signature, type, module,
        calls: [], calledBy: [], throws: [],
        isExported, language: 'go',
    };
}
