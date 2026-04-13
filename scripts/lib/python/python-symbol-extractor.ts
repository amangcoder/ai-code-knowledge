import { SymbolEntry } from '../../../src/types.js';
import * as path from 'path';

const CLASS_RE = /^(\s*)class\s+(\w+)(?:\(([^)]*)\))?\s*:/;
const DEF_RE = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/;
const DECORATOR_RE = /^\s*@(\w[\w.]*)/;
const DUNDER_RE = /^__\w+__$/;

/**
 * Determines if a Python symbol name should be considered exported.
 * Top-level symbols are exported unless prefixed with `_`.
 * Methods follow the same rule, but dunder methods (__init__, __str__, etc.) are always exported.
 */
function isSymbolExported(name: string, isMethod: boolean): boolean {
    if (isMethod && DUNDER_RE.test(name)) {
        return true;
    }
    return !name.startsWith('_');
}

/**
 * Strips `self` or `cls` from the beginning of a parameter list string.
 */
function stripSelfCls(params: string): string {
    return params
        .replace(/^\s*(self|cls)\s*,\s*/, '')
        .replace(/^\s*(self|cls)\s*$/, '')
        .trim();
}

/**
 * Joins continuation lines for multiline function signatures.
 * Starting from `startIndex`, reads lines until the combined text contains
 * the closing `):` pattern, then returns the joined single line and
 * how many extra lines were consumed.
 */
function joinMultilineDef(
    lines: string[],
    startIndex: number
): { joined: string; consumed: number } {
    let combined = lines[startIndex];
    let consumed = 0;

    // Check if the def line already has ): on it
    if (/\)\s*(?:->[^:]+)?\s*:\s*$/.test(combined)) {
        return { joined: combined, consumed: 0 };
    }

    // Keep appending lines until we find the closing ):
    for (let i = startIndex + 1; i < lines.length; i++) {
        consumed++;
        combined += ' ' + lines[i].trim();
        if (/\)\s*(?:->[^:]+)?\s*:\s*$/.test(combined)) {
            break;
        }
    }

    return { joined: combined, consumed };
}

/**
 * Regex-based Python symbol extractor.
 * Produces SymbolEntry[] from Python source code using line-by-line scanning
 * with indentation tracking. No Python runtime or tree-sitter dependency.
 */
export function extractPythonSymbols(
    filePath: string,
    content: string,
    projectRoot: string
): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');
    const moduleName = path.basename(path.dirname(filePath));

    // Normalize tabs to 4 spaces
    const normalized = content.replace(/\t/g, '    ');
    const lines = normalized.split('\n');

    // State tracking
    let currentClass: string | null = null;
    let currentClassIndent: number = -1;
    let decoratorBuffer: string[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const lineNumber = i + 1; // 1-based

        // Skip blank lines — do NOT clear decorator buffer on blanks
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Compute indentation of the current non-blank line
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;

        // If we're inside a class context and indentation returns to class level or less,
        // clear the class context
        if (currentClass !== null && indent <= currentClassIndent) {
            currentClass = null;
            currentClassIndent = -1;
        }

        // Check for decorator
        const decoratorMatch = line.match(DECORATOR_RE);
        if (decoratorMatch) {
            decoratorBuffer.push(decoratorMatch[1]);
            i++;
            continue;
        }

        // Check for class definition
        const classMatch = line.match(CLASS_RE);
        if (classMatch) {
            const classIndent = classMatch[1].length;
            const className = classMatch[2];
            const bases = classMatch[3] ? classMatch[3].trim() : '';

            const decoratorPrefix = decoratorBuffer.length > 0
                ? decoratorBuffer.map(d => `@${d}`).join(' ') + ' '
                : '';
            const signature = bases
                ? `${decoratorPrefix}class ${className}(${bases})`
                : `${decoratorPrefix}class ${className}`;

            // For a class nested inside another class, treat it as top-level for naming
            // (Python doesn't truly nest class namespaces for symbol resolution)
            const qualifiedName = currentClass
                ? `${currentClass}.${className}`
                : className;

            symbols.push({
                name: className,
                qualifiedName,
                file: relativePath,
                line: lineNumber,
                signature,
                type: 'class',
                module: moduleName,
                calls: [],
                calledBy: [],
                throws: [],
                isExported: isSymbolExported(className, false),
                language: 'python'
            });

            // Set class context for subsequent methods
            currentClass = className;
            currentClassIndent = classIndent;
            decoratorBuffer = [];
            i++;
            continue;
        }

        // Check for function/method definition
        // First try to match on the current line
        let defLine = line;
        let consumed = 0;

        // If the line starts a def but doesn't close with ):, join continuation lines
        if (/^(\s*)(?:async\s+)?def\s+/.test(line) && !DEF_RE.test(line)) {
            const result = joinMultilineDef(lines, i);
            defLine = result.joined;
            consumed = result.consumed;
        }

        const defMatch = defLine.match(DEF_RE);
        if (defMatch) {
            const defIndent = defMatch[1].length;
            const funcName = defMatch[2];
            const rawParams = defMatch[3] ? defMatch[3].trim() : '';
            const returnType = defMatch[4] ? defMatch[4].trim() : '';

            const isMethod = currentClass !== null && defIndent > currentClassIndent;

            // Build display params: strip self/cls for methods
            const displayParams = isMethod ? stripSelfCls(rawParams) : rawParams;

            const decoratorPrefix = decoratorBuffer.length > 0
                ? decoratorBuffer.map(d => `@${d}`).join(' ') + ' '
                : '';

            const isAsync = /^\s*async\s+def/.test(defLine);
            const asyncPrefix = isAsync ? 'async ' : '';

            let signature = returnType
                ? `${decoratorPrefix}${asyncPrefix}def ${funcName}(${displayParams}) -> ${returnType}`
                : `${decoratorPrefix}${asyncPrefix}def ${funcName}(${displayParams})`;

            const qualifiedName = isMethod
                ? `${currentClass}.${funcName}`
                : funcName;

            symbols.push({
                name: funcName,
                qualifiedName,
                file: relativePath,
                line: lineNumber,
                signature,
                type: isMethod ? 'method' : 'function',
                module: moduleName,
                calls: [],
                calledBy: [],
                throws: [],
                isExported: isSymbolExported(funcName, isMethod),
                language: 'python'
            });

            decoratorBuffer = [];
            i += 1 + consumed;
            continue;
        }

        // If we reach a non-decorator, non-class, non-def line, clear decorator buffer
        decoratorBuffer = [];
        i++;
    }

    return symbols;
}
