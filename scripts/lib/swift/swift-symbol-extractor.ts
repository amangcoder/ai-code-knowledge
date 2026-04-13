import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Type declarations
const CLASS_RE = /^(?:(open|public|internal|fileprivate|private)\s+)?(?:(final)\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w<>, .]+))?\s*\{/;
const STRUCT_RE = /^(?:(public|internal|fileprivate|private)\s+)?struct\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w<>, .]+))?\s*\{/;
const PROTOCOL_RE = /^(?:(public|internal|fileprivate|private)\s+)?protocol\s+(\w+)(?:\s*:\s*([\w<>, .]+))?\s*\{/;
const ENUM_RE = /^(?:(public|internal|fileprivate|private)\s+)?(?:indirect\s+)?enum\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w<>, .]+))?\s*\{/;
const TYPEALIAS_RE = /^(?:(public|internal|fileprivate|private)\s+)?typealias\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*)/;
const EXTENSION_RE = /^(?:(public|internal|fileprivate|private)\s+)?extension\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w<>, .]+))?\s*(?:where\s+[^{]*)?\{/;

// Function declarations
const FUNC_RE = /^(?:(open|public|internal|fileprivate|private|override)\s+)*(?:(static|class)\s+)?(?:(mutating|nonmutating)\s+)?func\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*(?:throws|rethrows))?\s*(?:->\s*([\w<>\[\]?, .()!]+))?/;
const INIT_RE = /^(?:(public|internal|fileprivate|private|convenience|required|override)\s+)*init\??\s*\(([^)]*)\)/;

// Property wrappers and attributes
const ATTR_RE = /^\s*@(\w+)/;

// Swift keywords
const SWIFT_KEYWORDS = new Set([
    'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate',
    'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator',
    'private', 'precedencegroup', 'protocol', 'public', 'rethrows', 'static',
    'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'catch',
    'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard',
    'if', 'in', 'repeat', 'return', 'switch', 'throw', 'try', 'where', 'while',
    'as', 'false', 'is', 'nil', 'self', 'Self', 'super', 'throws', 'true',
]);

/**
 * Count net brace depth change on a single line.
 */
function netBraces(line: string): number {
    let depth = 0;
    let inString = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && inString) {
            i += 2;
            continue;
        }
        if (ch === '"' ) { inString = !inString; }
        else if (!inString) {
            if (ch === '/' && line[i + 1] === '/') break;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        i++;
    }
    return depth;
}

/**
 * Swift access levels: public/open are exported, internal (default) is semi-exported,
 * fileprivate/private are not.
 */
function isSwiftExported(access: string): boolean {
    return access !== 'fileprivate' && access !== 'private';
}

/**
 * Regex-based Swift symbol extractor.
 * Uses brace-depth tracking for type and extension scoping.
 */
export function extractSwiftSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const moduleName = path.basename(path.dirname(filePath));

    const lines = content.split('\n');
    let braceDepth = 0;

    const containerStack: Array<{ name: string; depth: number }> = [];
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

        // Pop containers
        while (containerStack.length > 0 && braceDepth <= containerStack[containerStack.length - 1].depth) {
            containerStack.pop();
        }

        // Collect attributes
        const attrMatch = trimmed.match(ATTR_RE);
        if (attrMatch && /^\s*@\w+(\([^)]*\))?\s*$/.test(trimmed)) {
            attrBuffer.push(attrMatch[1]);
            continue;
        }

        const currentContainer = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
        const expectedDepth = containerStack.length;

        // Type declarations
        if (depthBefore === expectedDepth) {
            // Class
            const classMatch = trimmed.match(CLASS_RE);
            if (classMatch) {
                const access = classMatch[1] || 'internal';
                const name = classMatch[3];
                const conformances = classMatch[4] || '';
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                let sig = `class ${name}`;
                if (conformances) sig += `: ${conformances}`;
                symbols.push(makeSymbol(name, qualifiedName, 'class', relativePath, lineNumber,
                    sig, moduleName, isSwiftExported(access), attrBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }

            // Struct
            const structMatch = trimmed.match(STRUCT_RE);
            if (structMatch) {
                const access = structMatch[1] || 'internal';
                const name = structMatch[2];
                const conformances = structMatch[3] || '';
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                let sig = `struct ${name}`;
                if (conformances) sig += `: ${conformances}`;
                symbols.push(makeSymbol(name, qualifiedName, 'class', relativePath, lineNumber,
                    sig, moduleName, isSwiftExported(access), attrBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }

            // Protocol
            const protoMatch = trimmed.match(PROTOCOL_RE);
            if (protoMatch) {
                const access = protoMatch[1] || 'internal';
                const name = protoMatch[2];
                const conformances = protoMatch[3] || '';
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                let sig = `protocol ${name}`;
                if (conformances) sig += `: ${conformances}`;
                symbols.push(makeSymbol(name, qualifiedName, 'interface', relativePath, lineNumber,
                    sig, moduleName, isSwiftExported(access), attrBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }

            // Enum
            const enumMatch = trimmed.match(ENUM_RE);
            if (enumMatch) {
                const access = enumMatch[1] || 'internal';
                const name = enumMatch[2];
                const conformances = enumMatch[3] || '';
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                let sig = `enum ${name}`;
                if (conformances) sig += `: ${conformances}`;
                symbols.push(makeSymbol(name, qualifiedName, 'enum', relativePath, lineNumber,
                    sig, moduleName, isSwiftExported(access), attrBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }

            // Extension
            const extMatch = trimmed.match(EXTENSION_RE);
            if (extMatch) {
                const name = extMatch[2];
                const conformances = extMatch[3] || '';
                const qualifiedName = name;
                let sig = `extension ${name}`;
                if (conformances) sig += `: ${conformances}`;
                // Don't push as a symbol — extensions augment existing types
                // But track for method attribution
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                attrBuffer = [];
                continue;
            }

            // Typealias
            const typealiasMatch = trimmed.match(TYPEALIAS_RE);
            if (typealiasMatch) {
                const access = typealiasMatch[1] || 'internal';
                const name = typealiasMatch[2];
                const target = typealiasMatch[3].trim();
                symbols.push(makeSymbol(name, name, 'type', relativePath, lineNumber,
                    `typealias ${name} = ${target}`, moduleName, isSwiftExported(access), attrBuffer, access));
                attrBuffer = [];
                continue;
            }
        }

        // Functions/methods and initializers
        if (depthBefore === expectedDepth) {
            // Initializer
            const initMatch = trimmed.match(INIT_RE);
            if (initMatch && currentContainer) {
                const access = initMatch[1] || 'internal';
                const params = initMatch[2].trim();
                const isFailable = trimmed.includes('init?');
                const sig = isFailable ? `init?(${params})` : `init(${params})`;
                symbols.push(makeSymbol(
                    'init', `${currentContainer.name}.init`, 'constructor',
                    relativePath, lineNumber, sig, moduleName,
                    isSwiftExported(access), attrBuffer, access,
                ));
                attrBuffer = [];
                continue;
            }

            // Function/method
            const funcMatch = trimmed.match(FUNC_RE);
            if (funcMatch) {
                const access = funcMatch[1] || 'internal';
                const funcName = funcMatch[4];
                const params = funcMatch[5]?.trim() || '';
                const returnType = funcMatch[6]?.trim() || '';

                if (!SWIFT_KEYWORDS.has(funcName)) {
                    const isMethod = currentContainer !== null;
                    const qualifiedName = isMethod
                        ? `${currentContainer!.name}.${funcName}`
                        : funcName;
                    const isAsync = trimmed.includes(' async ') || trimmed.includes(' async{');

                    let sig = `func ${funcName}(${params})`;
                    if (returnType) sig += ` -> ${returnType}`;

                    symbols.push(makeSymbol(
                        funcName, qualifiedName,
                        isMethod ? 'method' : 'function',
                        relativePath, lineNumber, sig, moduleName,
                        isSwiftExported(access), attrBuffer, access, isAsync,
                    ));
                    attrBuffer = [];
                    continue;
                }
            }
        }

        // Clear attribute buffer
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
        isExported, language: 'swift',
        ...(decorators && decorators.length > 0 && { decorators }),
        ...(accessModifier && { accessModifier }),
        ...(isAsync && { isAsync }),
    };
}
