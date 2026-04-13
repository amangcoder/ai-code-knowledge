import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Class declarations (class, data class, sealed class, abstract class, object, enum class)
const CLASS_RE = /^(?:(public|protected|private|internal)\s+)?(?:(abstract|sealed|data|open|inner|value|inline)\s+)?class\s+(\w+)/;
const OBJECT_RE = /^(?:(public|protected|private|internal)\s+)?(?:companion\s+)?object\s+(\w+)/;
const ENUM_CLASS_RE = /^(?:(public|protected|private|internal)\s+)?(?:sealed\s+)?enum\s+class\s+(\w+)/;
const INTERFACE_RE = /^(?:(public|protected|private|internal)\s+)?(?:sealed\s+)?(?:fun\s+)?interface\s+(\w+)/;
const TYPEALIAS_RE = /^(?:(public|protected|private|internal)\s+)?typealias\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*)/;
const ANNOTATION_CLASS_RE = /^(?:(public|protected|private|internal)\s+)?annotation\s+class\s+(\w+)/;

// Function declarations
const FUN_RE = /^(?:(public|protected|private|internal|override)\s+)*(?:(suspend|inline|infix|operator|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s+)?(?:(\w+)\.)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([\w<>\[\]?, .]+))?/;

// Annotations
const ANNOTATION_RE = /^\s*@(\w+)/;

// Kotlin keywords
const KOTLIN_KEYWORDS = new Set([
    'if', 'else', 'when', 'for', 'while', 'do', 'break', 'continue', 'return',
    'throw', 'try', 'catch', 'finally', 'class', 'interface', 'object', 'fun',
    'val', 'var', 'typealias', 'constructor', 'init', 'companion', 'this', 'super',
    'package', 'import', 'as', 'is', 'in', 'out', 'where', 'by', 'get', 'set',
    'null', 'true', 'false', 'it', 'field', 'delegate', 'dynamic', 'suspend',
    'sealed', 'data', 'inner', 'enum', 'annotation', 'abstract', 'open', 'final',
    'override', 'private', 'protected', 'public', 'internal', 'inline', 'infix',
    'operator', 'tailrec', 'external', 'crossinline', 'noinline', 'reified',
    'lateinit', 'const', 'vararg', 'value',
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
        else if (ch === '\'' && !inString) { inChar = !inChar; }
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
 * Regex-based Kotlin symbol extractor.
 * Uses brace-depth tracking and supports Kotlin-specific constructs.
 */
export function extractKotlinSymbols(
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
    let annotationBuffer: string[] = [];

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

        // Collect annotations
        const annoMatch = trimmed.match(ANNOTATION_RE);
        if (annoMatch && /^\s*@\w+(\([^)]*\))?\s*$/.test(trimmed)) {
            annotationBuffer.push(annoMatch[1]);
            continue;
        }

        const currentContainer = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
        const expectedDepth = containerStack.length;
        const isExportedAccess = (access: string) => access !== 'private' && access !== 'protected';

        // Type declarations at appropriate depth
        if (depthBefore === expectedDepth) {
            // Enum class
            const enumMatch = trimmed.match(ENUM_CLASS_RE);
            if (enumMatch) {
                const access = enumMatch[1] || 'public';
                const name = enumMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(name, qualifiedName, 'enum', relativePath, lineNumber,
                    `${access} enum class ${name}`.replace(/\s+/g, ' ').trim(), moduleName,
                    isExportedAccess(access), annotationBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Annotation class
            const annoClassMatch = trimmed.match(ANNOTATION_CLASS_RE);
            if (annoClassMatch) {
                const access = annoClassMatch[1] || 'public';
                const name = annoClassMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(name, qualifiedName, 'decorator', relativePath, lineNumber,
                    `annotation class ${name}`, moduleName, isExportedAccess(access), annotationBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Interface
            const ifaceMatch = trimmed.match(INTERFACE_RE);
            if (ifaceMatch) {
                const access = ifaceMatch[1] || 'public';
                const name = ifaceMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(name, qualifiedName, 'interface', relativePath, lineNumber,
                    `${access} interface ${name}`.replace(/\s+/g, ' ').trim(), moduleName,
                    isExportedAccess(access), annotationBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Object (including companion object)
            const objMatch = trimmed.match(OBJECT_RE);
            if (objMatch) {
                const access = objMatch[1] || 'public';
                const name = objMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                const isCompanion = trimmed.includes('companion');
                const sig = isCompanion ? `companion object ${name}` : `object ${name}`;
                symbols.push(makeSymbol(name, qualifiedName, 'class', relativePath, lineNumber,
                    sig, moduleName, isExportedAccess(access), annotationBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Class (data class, sealed class, abstract class, etc.)
            const classMatch = trimmed.match(CLASS_RE);
            if (classMatch) {
                const access = classMatch[1] || 'public';
                const modifier = classMatch[2] || '';
                const name = classMatch[3];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                const sig = `${access} ${modifier} class ${name}`.replace(/\s+/g, ' ').trim();
                symbols.push(makeSymbol(name, qualifiedName, 'class', relativePath, lineNumber,
                    sig, moduleName, isExportedAccess(access), annotationBuffer, access));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Typealias
            const typealiasMatch = trimmed.match(TYPEALIAS_RE);
            if (typealiasMatch) {
                const access = typealiasMatch[1] || 'public';
                const name = typealiasMatch[2];
                const target = typealiasMatch[3].trim();
                symbols.push(makeSymbol(name, name, 'type', relativePath, lineNumber,
                    `typealias ${name} = ${target}`, moduleName, isExportedAccess(access), annotationBuffer, access));
                annotationBuffer = [];
                continue;
            }
        }

        // Functions/methods
        const funMatch = trimmed.match(FUN_RE);
        if (funMatch && depthBefore === expectedDepth) {
            const access = funMatch[1] || 'public';
            const isSuspend = trimmed.includes('suspend ');
            const receiverType = funMatch[3] || null; // extension function receiver
            const funcName = funMatch[4];
            const params = funMatch[5]?.trim() || '';
            const returnType = funMatch[6]?.trim() || '';

            if (!KOTLIN_KEYWORDS.has(funcName)) {
                const isMethod = currentContainer !== null && !receiverType;
                const qualifiedName = isMethod
                    ? `${currentContainer!.name}.${funcName}`
                    : receiverType
                        ? `${receiverType}.${funcName}`
                        : funcName;

                let sig = `fun ${funcName}(${params})`;
                if (receiverType) sig = `fun ${receiverType}.${funcName}(${params})`;
                if (returnType) sig += `: ${returnType}`;
                if (isSuspend) sig = `suspend ${sig}`;

                symbols.push(makeSymbol(
                    funcName, qualifiedName,
                    isMethod ? 'method' : 'function',
                    relativePath, lineNumber, sig, moduleName,
                    access !== 'private',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access,
                    isSuspend,
                ));
                annotationBuffer = [];
                continue;
            }
        }

        // Clear annotation buffer on non-matching lines
        if (!trimmed.match(ANNOTATION_RE)) {
            annotationBuffer = [];
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
        isExported, language: 'kotlin',
        ...(decorators && decorators.length > 0 && { decorators }),
        ...(accessModifier && { accessModifier }),
        ...(isAsync && { isAsync }),
    };
}
