import * as path from 'node:path';
import type { SymbolEntry } from '../../../src/types.js';

// Class/interface/enum declarations
const CLASS_RE = /^(?:(public|protected|private)\s+)?(?:(abstract|final|sealed)\s+)?(?:(static)\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.<>, ]+))?(?:\s+implements\s+([\w.<>, ]+))?\s*\{/;
const INTERFACE_RE = /^(?:(public|protected|private)\s+)?(?:(sealed)\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.<>, ]+))?\s*\{/;
const ENUM_RE = /^(?:(public|protected|private)\s+)?enum\s+(\w+)(?:\s+implements\s+([\w.<>, ]+))?\s*\{/;
const RECORD_RE = /^(?:(public|protected|private)\s+)?(?:(sealed)\s+)?record\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;
const ANNOTATION_RE = /^(?:(public|protected|private)\s+)?@interface\s+(\w+)\s*\{/;

// Method/constructor declaration
const METHOD_RE = /^(?:(public|protected|private)\s+)?(?:(static|abstract|final|synchronized|native|default)\s+)*(?:([\w<>\[\]?,. ]+)\s+)(\w+)\s*\(([^)]*)\)/;
const CONSTRUCTOR_RE = /^(?:(public|protected|private)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,.\s]+)?\s*\{/;

// Annotations on declarations
const ANNOTATION_USAGE_RE = /^\s*@(\w+)/;

// Java keywords to exclude from method name matches
const JAVA_KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'return', 'throw', 'try', 'catch', 'finally', 'new', 'class', 'interface',
    'extends', 'implements', 'import', 'package', 'public', 'private', 'protected',
    'static', 'final', 'abstract', 'synchronized', 'volatile', 'transient', 'native',
    'void', 'boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double',
    'this', 'super', 'null', 'true', 'false', 'instanceof', 'enum', 'assert',
    'default', 'var', 'yield', 'record', 'sealed', 'permits',
]);

/**
 * Count net brace depth change on a single line,
 * ignoring braces inside string literals and comments.
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
 * Regex-based Java symbol extractor.
 * Uses brace-depth tracking to distinguish class-level and method-level declarations.
 */
export function extractJavaSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const moduleName = path.basename(path.dirname(filePath));

    const lines = content.split('\n');
    let braceDepth = 0;

    // Stack of class/interface/enum containers
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

        // Pop containers whose depth exceeds current brace depth
        while (containerStack.length > 0 && braceDepth <= containerStack[containerStack.length - 1].depth) {
            containerStack.pop();
        }

        // Collect annotations
        const annoMatch = trimmed.match(ANNOTATION_USAGE_RE);
        if (annoMatch && !trimmed.match(/^@interface/)) {
            annotationBuffer.push(annoMatch[1]);
            // If this line is only an annotation, continue
            if (/^\s*@\w+(\([^)]*\))?\s*$/.test(trimmed)) continue;
        }

        const currentContainer = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
        const expectedDepth = containerStack.length;

        // Class declarations
        if (depthBefore === expectedDepth) {
            // Class
            const classMatch = trimmed.match(CLASS_RE);
            if (classMatch) {
                const access = classMatch[1] || '';
                const modifier = classMatch[2] || '';
                const name = classMatch[4];
                const ext = classMatch[5] || '';
                const impl = classMatch[6] || '';
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;

                let sig = `${access} ${modifier} class ${name}`.replace(/\s+/g, ' ').trim();
                if (ext) sig += ` extends ${ext}`;
                if (impl) sig += ` implements ${impl}`;

                symbols.push(makeSymbol(
                    name, qualifiedName, 'class',
                    relativePath, lineNumber, sig, moduleName,
                    access !== 'private' && access !== 'protected',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Interface
            const ifaceMatch = trimmed.match(INTERFACE_RE);
            if (ifaceMatch) {
                const access = ifaceMatch[1] || '';
                const name = ifaceMatch[3];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                const ext = ifaceMatch[4] || '';

                let sig = `${access} interface ${name}`.replace(/\s+/g, ' ').trim();
                if (ext) sig += ` extends ${ext}`;

                symbols.push(makeSymbol(
                    name, qualifiedName, 'interface',
                    relativePath, lineNumber, sig, moduleName,
                    access !== 'private' && access !== 'protected',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Annotation type
            const annoTypeMatch = trimmed.match(ANNOTATION_RE);
            if (annoTypeMatch) {
                const access = annoTypeMatch[1] || '';
                const name = annoTypeMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(
                    name, qualifiedName, 'interface',
                    relativePath, lineNumber, `${access} @interface ${name}`.trim(), moduleName,
                    access !== 'private' && access !== 'protected',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Enum
            const enumMatch = trimmed.match(ENUM_RE);
            if (enumMatch) {
                const access = enumMatch[1] || '';
                const name = enumMatch[2];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(
                    name, qualifiedName, 'enum',
                    relativePath, lineNumber, `${access} enum ${name}`.replace(/\s+/g, ' ').trim(), moduleName,
                    access !== 'private' && access !== 'protected',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }

            // Record
            const recordMatch = trimmed.match(RECORD_RE);
            if (recordMatch) {
                const access = recordMatch[1] || '';
                const name = recordMatch[3];
                const qualifiedName = currentContainer ? `${currentContainer.name}.${name}` : name;
                symbols.push(makeSymbol(
                    name, qualifiedName, 'class',
                    relativePath, lineNumber, `${access} record ${name}`.replace(/\s+/g, ' ').trim(), moduleName,
                    access !== 'private' && access !== 'protected',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                containerStack.push({ name: qualifiedName, depth: depthBefore });
                annotationBuffer = [];
                continue;
            }
        }

        // Methods and constructors — must be inside a class (depth = containerStack.length)
        if (currentContainer && depthBefore === containerStack.length) {
            // Constructor: ClassName(...)
            const ctorMatch = trimmed.match(CONSTRUCTOR_RE);
            if (ctorMatch && ctorMatch[2] === containerStack[containerStack.length - 1].name.split('.').pop()) {
                const access = ctorMatch[1] || '';
                const name = ctorMatch[2];
                const params = ctorMatch[3].trim();
                symbols.push(makeSymbol(
                    name, `${currentContainer.name}.${name}`,
                    'constructor',
                    relativePath, lineNumber,
                    `${access} ${name}(${params})`.replace(/\s+/g, ' ').trim(),
                    moduleName,
                    access !== 'private',
                    annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                    access || undefined,
                ));
                annotationBuffer = [];
                continue;
            }

            // Method
            const methodMatch = trimmed.match(METHOD_RE);
            if (methodMatch) {
                const access = methodMatch[1] || '';
                const returnType = methodMatch[3]?.trim() || 'void';
                const methodName = methodMatch[4];
                const params = methodMatch[5].trim();

                if (!JAVA_KEYWORDS.has(methodName)) {
                    const sig = `${access} ${returnType} ${methodName}(${params})`.replace(/\s+/g, ' ').trim();
                    symbols.push(makeSymbol(
                        methodName, `${currentContainer.name}.${methodName}`,
                        'method',
                        relativePath, lineNumber, sig, moduleName,
                        access !== 'private',
                        annotationBuffer.length > 0 ? [...annotationBuffer] : undefined,
                        access || undefined,
                    ));
                    annotationBuffer = [];
                    continue;
                }
            }
        }

        // Clear annotation buffer on non-annotation, non-declaration lines
        if (!trimmed.match(ANNOTATION_USAGE_RE)) {
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
): SymbolEntry {
    return {
        name, qualifiedName, file, line, signature, type, module,
        calls: [], calledBy: [], throws: [],
        isExported, language: 'java',
        ...(decorators && { decorators }),
        ...(accessModifier && { accessModifier }),
    };
}
