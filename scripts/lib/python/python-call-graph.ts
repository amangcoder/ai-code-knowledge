import * as path from 'node:path';
import { SymbolEntry } from '../../../src/types.js';

/**
 * Regex for simple function calls: `foo(`, `bar_baz(`
 */
const SIMPLE_CALL_RE = /\b(\w+)\s*\(/g;

/**
 * Regex for method / qualified calls: `ClassName.method_name(`
 */
const METHOD_CALL_RE = /\b(\w+)\.(\w+)\s*\(/g;

/**
 * Regex to detect a `def` line and capture its indentation + name.
 * Captures: group 1 = leading whitespace, group 2 = function name.
 */
const DEF_LINE_RE = /^(\s*)def\s+(\w+)\s*\(/;

/**
 * Creates or retrieves a module-init symbol for top-level calls in a Python file.
 */
function getOrCreateModuleInitSymbol(
    symbolMap: Map<string, SymbolEntry>,
    newSymbols: SymbolEntry[],
    relativePath: string
): SymbolEntry {
    const qualifiedName = `<module-init:${relativePath}>`;

    let sym = symbolMap.get(qualifiedName);
    if (!sym) {
        const moduleName = path.basename(path.dirname(relativePath));
        sym = {
            name: '<module-init>',
            qualifiedName,
            file: relativePath,
            line: 1,
            signature: `<module-init:${relativePath}>`,
            type: 'module-init',
            module: moduleName,
            calls: [],
            calledBy: [],
            throws: [],
            isExported: false,
            language: 'python',
        };
        newSymbols.push(sym);
        symbolMap.set(qualifiedName, sym);
    }
    return sym;
}

/**
 * Determines the enclosing function/method scope for a given line based on
 * Python indentation. Returns the qualified name of the enclosing def, or
 * null if the line is at module (top-level) scope.
 *
 * `defStack` is mutated: stale entries whose indentation is >= the current
 * line's indentation are popped before the lookup.
 */
function resolveEnclosingDef(
    line: string,
    defStack: Array<{ indent: number; qualifiedName: string }>
): string | null {
    // Blank / comment-only lines don't change scope — attribute to current top of stack.
    const stripped = line.trimStart();
    if (stripped.length === 0 || stripped.startsWith('#')) {
        return defStack.length > 0 ? defStack[defStack.length - 1].qualifiedName : null;
    }

    const lineIndent = line.length - stripped.length;

    // Pop any defs whose body we have left (indent <= their indent means we
    // are at the same or outer level).
    while (defStack.length > 0 && lineIndent <= defStack[defStack.length - 1].indent) {
        defStack.pop();
    }

    return defStack.length > 0 ? defStack[defStack.length - 1].qualifiedName : null;
}

/**
 * Parallel set for O(1) dedup when adding calls.
 */
const callsSets = new Map<string, Set<string>>();

/**
 * Adds `calleeQualifiedName` to `caller.calls` if not already present.
 * Uses a parallel Set for O(1) membership checks instead of Array.includes().
 */
function addCall(caller: SymbolEntry, calleeQualifiedName: string): void {
    let set = callsSets.get(caller.qualifiedName);
    if (!set) {
        set = new Set(caller.calls);
        callsSets.set(caller.qualifiedName, set);
    }
    if (!set.has(calleeQualifiedName)) {
        set.add(calleeQualifiedName);
        caller.calls.push(calleeQualifiedName);
    }
}

/**
 * Builds a regex-based call graph for Python symbols.
 *
 * This is intentionally imprecise — it captures most direct calls but won't
 * catch aliased or dynamic calls. The caller (build-knowledge.ts) is expected
 * to run `invertCallGraph()` on the merged result, so this function only
 * populates `calls` arrays.
 *
 * @param symbols     All known Python SymbolEntry objects (will NOT be mutated).
 * @param fileContents Map of absolute file path -> file source text.
 * @param projectRoot Absolute path to the project root (used for relativising paths).
 * @returns A new array of SymbolEntry objects with `calls` populated.
 */
export function buildPythonCallGraph(
    symbols: SymbolEntry[],
    fileContents: Map<string, string>,
    projectRoot: string
): SymbolEntry[] {
    // 0. Clear the dedup cache from any prior invocation.
    callsSets.clear();

    // 1. Clone symbols to avoid mutating the input array.
    const newSymbols: SymbolEntry[] = symbols.map(s => ({
        ...s,
        calls: [...s.calls],
    }));

    // 2. Build a lookup map: qualifiedName -> SymbolEntry
    const symbolMap = new Map<string, SymbolEntry>();
    for (const sym of newSymbols) {
        symbolMap.set(sym.qualifiedName, sym);
    }

    // 3. Build secondary indexes for fast matching.
    //    nameIndex: simple name -> list of qualified names that share it
    const nameIndex = new Map<string, string[]>();
    for (const sym of newSymbols) {
        const existing = nameIndex.get(sym.name);
        if (existing) {
            existing.push(sym.qualifiedName);
        } else {
            nameIndex.set(sym.name, [sym.qualifiedName]);
        }
    }

    // 4. Process each source file.
    for (const [absolutePath, content] of fileContents) {
        const relativePath = path.relative(projectRoot, absolutePath);
        const lines = content.split('\n');

        // Stack of enclosing `def` scopes, ordered from outermost to innermost.
        // Each entry records the indentation level of the `def` keyword and the
        // qualifiedName of the symbol it corresponds to.
        const defStack: Array<{ indent: number; qualifiedName: string }> = [];

        // Stack of enclosing class scopes, ordered outermost to innermost.
        const classStack: Array<{ name: string; indent: number }> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const stripped = line.trimStart();
            if (stripped.length === 0) continue;

            const lineIndent = line.length - stripped.length;

            // --- Track class scope (supports nesting) ---
            if (stripped.startsWith('class ')) {
                const classMatch = stripped.match(/^class\s+(\w+)/);
                if (classMatch) {
                    // Pop any classes at same or deeper indent
                    while (classStack.length > 0 && classStack[classStack.length - 1].indent >= lineIndent) {
                        classStack.pop();
                    }
                    classStack.push({ name: classMatch[1], indent: lineIndent });
                    defStack.length = 0;
                    continue;
                }
            }

            // If we've dedented past all class levels, clear the stack
            while (classStack.length > 0 && lineIndent <= classStack[classStack.length - 1].indent && !stripped.startsWith('class ')) {
                classStack.pop();
                defStack.length = 0;
            }

            const currentClass = classStack.length > 0 ? classStack[classStack.length - 1].name : null;

            // --- Detect `def` lines and push onto scope stack ---
            const defMatch = line.match(DEF_LINE_RE);
            if (defMatch) {
                const defIndent = defMatch[1].length;
                const funcName = defMatch[2];

                // Pop scopes that are at the same or deeper indent (sibling or nested replaced).
                while (defStack.length > 0 && defStack[defStack.length - 1].indent >= defIndent) {
                    defStack.pop();
                }

                // Build the qualified name for this def.
                let qualifiedName: string;
                if (currentClass !== null) {
                    qualifiedName = `${currentClass}.${funcName}`;
                } else {
                    qualifiedName = funcName;
                }

                defStack.push({ indent: defIndent, qualifiedName });
                continue; // The def line itself doesn't contain calls we care about.
            }

            // --- Resolve the enclosing scope for this line ---
            const enclosingQualifiedName = resolveEnclosingDef(line, defStack);

            let callerSymbol: SymbolEntry | undefined;
            if (enclosingQualifiedName) {
                callerSymbol = symbolMap.get(enclosingQualifiedName);
            }
            if (!callerSymbol) {
                // Top-level code — attribute to module-init.
                callerSymbol = getOrCreateModuleInitSymbol(symbolMap, newSymbols, relativePath);
                // Also add to nameIndex for completeness.
                if (!nameIndex.has('<module-init>')) {
                    nameIndex.set('<module-init>', []);
                }
                const initList = nameIndex.get('<module-init>')!;
                if (!initList.includes(callerSymbol.qualifiedName)) {
                    initList.push(callerSymbol.qualifiedName);
                }
            }

            // --- Match method / qualified calls first (more specific) ---
            const matchedMethodCalls = new Set<string>();
            let methodMatch: RegExpExecArray | null;
            METHOD_CALL_RE.lastIndex = 0;
            while ((methodMatch = METHOD_CALL_RE.exec(line)) !== null) {
                const objectName = methodMatch[1];
                const methodName = methodMatch[2];
                const qualifiedCandidate = `${objectName}.${methodName}`;

                if (symbolMap.has(qualifiedCandidate)) {
                    addCall(callerSymbol, qualifiedCandidate);
                    matchedMethodCalls.add(methodMatch.index.toString());
                }
            }

            // --- Match simple calls ---
            let simpleMatch: RegExpExecArray | null;
            SIMPLE_CALL_RE.lastIndex = 0;
            while ((simpleMatch = SIMPLE_CALL_RE.exec(line)) !== null) {
                const callName = simpleMatch[1];

                // Skip Python keywords that look like calls.
                if (isPythonKeyword(callName)) continue;

                // Skip if this position was already matched as part of a method call.
                // (The simple regex will also match the method part of `Foo.bar(` as `bar(`.)
                // We don't need byte-exact dedup — just skip names that are Python builtins
                // or not in our symbol table.

                const candidates = nameIndex.get(callName);
                if (!candidates) continue;

                // If there's exactly one symbol with this name, it's unambiguous.
                if (candidates.length === 1) {
                    addCall(callerSymbol, candidates[0]);
                } else {
                    // Multiple symbols share this name. Prefer one from the same file,
                    // then fall back to adding all of them.
                    const sameFile = candidates.filter(qn => {
                        const sym = symbolMap.get(qn);
                        return sym && sym.file === relativePath;
                    });
                    if (sameFile.length > 0) {
                        for (const qn of sameFile) {
                            addCall(callerSymbol, qn);
                        }
                    } else {
                        for (const qn of candidates) {
                            addCall(callerSymbol, qn);
                        }
                    }
                }
            }
        }
    }

    return newSymbols;
}

const PYTHON_KEYWORDS = new Set([
    'if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except',
    'finally', 'return', 'yield', 'import', 'from', 'as', 'pass',
    'break', 'continue', 'raise', 'del', 'assert', 'lambda',
    'global', 'nonlocal', 'class', 'def', 'and', 'or', 'not', 'is',
    'in', 'True', 'False', 'None', 'async', 'await',
]);

/**
 * Returns true if the identifier is a Python keyword or builtin statement
 * that uses parentheses but is not a callable symbol.
 */
function isPythonKeyword(name: string): boolean {
    return PYTHON_KEYWORDS.has(name);
}
