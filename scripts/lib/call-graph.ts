import * as path from 'node:path';
import { Project, Node, SyntaxKind, SourceFile, FunctionDeclaration } from 'ts-morph';
import { SymbolEntry } from '../../src/types.js';

/**
 * Creates or retrieves a module-init symbol for top-level calls in a file.
 */
function getOrCreateModuleInitSymbol(
    symbolMap: Map<string, SymbolEntry>,
    newSymbols: SymbolEntry[],
    sourceFile: SourceFile,
    projectRoot: string
): SymbolEntry {
    const filePath = sourceFile.getFilePath();
    const relativePath = projectRoot
        ? path.relative(projectRoot, filePath)
        : filePath;
    const moduleName = path.basename(path.dirname(filePath));
    const qualifiedName = `<module-init:${relativePath}>`;

    let sym = symbolMap.get(qualifiedName);
    if (!sym) {
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
        };
        newSymbols.push(sym);
        symbolMap.set(qualifiedName, sym);
    }
    return sym;
}

/**
 * Processes all call expressions in a single source file, populating the calls sets.
 * Uses a Set-based approach internally to avoid O(n²) .includes() checks.
 */
function processCallExpressionsInFile(
    sourceFile: SourceFile,
    symbolMap: Map<string, SymbolEntry>,
    newSymbols: SymbolEntry[],
    projectRoot: string,
    callsSets: Map<string, Set<string>>
): void {
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
        // Find the enclosing function or method using AST traversal
        let enclosingFn: Node | undefined =
            callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
            callExpr.getFirstAncestorByKind(SyntaxKind.MethodDeclaration) ??
            callExpr.getFirstAncestorByKind(SyntaxKind.GetAccessor) ??
            callExpr.getFirstAncestorByKind(SyntaxKind.SetAccessor);

        // Check for arrow functions / function expressions inside variable declarations
        if (!enclosingFn) {
            const arrowOrFnExpr =
                callExpr.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
                callExpr.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
            if (arrowOrFnExpr) {
                const varDecl = arrowOrFnExpr.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
                if (varDecl) enclosingFn = varDecl;
            }
        }

        let callerSymbol: SymbolEntry | undefined;

        if (!enclosingFn) {
            // Top-level call — attribute to module-init symbol
            callerSymbol = getOrCreateModuleInitSymbol(symbolMap, newSymbols, sourceFile, projectRoot);
        } else {
            let enclosingQualifiedName: string | undefined;
            if (Node.isMethodDeclaration(enclosingFn)) {
                const cls = enclosingFn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    enclosingQualifiedName = `${cls.getName()}.${enclosingFn.getName()}`;
                }
            } else if (Node.isGetAccessorDeclaration(enclosingFn)) {
                const cls = enclosingFn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    enclosingQualifiedName = `${cls.getName()}.get:${enclosingFn.getName()}`;
                }
            } else if (Node.isSetAccessorDeclaration(enclosingFn)) {
                const cls = enclosingFn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    enclosingQualifiedName = `${cls.getName()}.set:${enclosingFn.getName()}`;
                }
            } else if (Node.isFunctionDeclaration(enclosingFn)) {
                enclosingQualifiedName = (enclosingFn as FunctionDeclaration).getName() ?? undefined;
            } else if (Node.isVariableDeclaration(enclosingFn)) {
                enclosingQualifiedName = enclosingFn.getName();
            }

            callerSymbol = enclosingQualifiedName ? symbolMap.get(enclosingQualifiedName) : undefined;
        }

        if (!callerSymbol) continue;

        // Resolve the called symbol
        const expression = callExpr.getExpression();
        let sym = expression.getSymbol();
        if (!sym) continue;

        // Follow import aliases to reach the original declaration
        const aliased = sym.getAliasedSymbol();
        if (aliased) sym = aliased;

        const declarations = sym.getDeclarations();
        for (const decl of declarations) {
            let calledQualifiedName: string | undefined;

            if (Node.isMethodDeclaration(decl)) {
                const cls = decl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    calledQualifiedName = `${cls.getName()}.${decl.getName()}`;
                }
            } else if (Node.isFunctionDeclaration(decl)) {
                calledQualifiedName = decl.getName();
            } else if (Node.isVariableDeclaration(decl)) {
                // Arrow function or function expression assigned to a variable
                const init = decl.getInitializer();
                if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                    calledQualifiedName = decl.getName();
                }
            } else if (Node.isGetAccessorDeclaration(decl)) {
                const cls = decl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    calledQualifiedName = `${cls.getName()}.get:${decl.getName()}`;
                }
            } else if (Node.isSetAccessorDeclaration(decl)) {
                const cls = decl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    calledQualifiedName = `${cls.getName()}.set:${decl.getName()}`;
                }
            }

            // If it's one of our project symbols, add it to the caller's calls set
            if (calledQualifiedName && symbolMap.has(calledQualifiedName)) {
                let callsSet = callsSets.get(callerSymbol.qualifiedName);
                if (!callsSet) {
                    callsSet = new Set(callerSymbol.calls);
                    callsSets.set(callerSymbol.qualifiedName, callsSet);
                }
                callsSet.add(calledQualifiedName);
            }
        }
    }
}

/**
 * Builds a call graph by identifying project symbols called by each symbol.
 * Does not mutate the input array.
 */
export function buildCallGraph(project: Project, symbols: SymbolEntry[], projectRoot?: string): SymbolEntry[] {
    // Create a new array with cloned objects to avoid mutating input
    const newSymbols: SymbolEntry[] = symbols.map(s => ({ ...s, calls: [...s.calls] }));

    // Lookup map for project symbols: qualifiedName -> SymbolEntry
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    const root = projectRoot ?? process.cwd();

    // Use Set-based dedup to avoid O(n²) .includes() in hot loops
    const callsSets = new Map<string, Set<string>>();

    // Iterate through all source files in the project
    for (const sourceFile of project.getSourceFiles()) {
        processCallExpressionsInFile(sourceFile, symbolMap, newSymbols, root, callsSets);
    }

    // Convert sets back to arrays on each symbol
    for (const [qualifiedName, callsSet] of callsSets) {
        const sym = symbolMap.get(qualifiedName);
        if (sym) {
            sym.calls = Array.from(callsSet);
        }
    }

    return newSymbols;
}

/**
 * Rebuilds call graph entries for a single changed file, then inverts the full graph.
 * More efficient than rebuilding the entire call graph for incremental updates.
 */
export function rebuildCallGraphForFile(
    project: Project,
    symbols: SymbolEntry[],
    absoluteFilePath: string,
    projectRoot: string
): SymbolEntry[] {
    // Create a new array with cloned objects to avoid mutating input
    const newSymbols: SymbolEntry[] = symbols.map(s => ({ ...s, calls: [...s.calls], calledBy: [...s.calledBy] }));

    // Lookup map for project symbols: qualifiedName -> SymbolEntry
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    // Use Set-based dedup to avoid O(n²) .includes() in hot loops
    const callsSets = new Map<string, Set<string>>();

    // Only process the changed file
    const sourceFile = project.getSourceFile(absoluteFilePath);
    if (sourceFile) {
        processCallExpressionsInFile(sourceFile, symbolMap, newSymbols, projectRoot, callsSets);
    }

    // Convert calls sets back to arrays on each symbol
    for (const [qualifiedName, callsSet] of callsSets) {
        const sym = symbolMap.get(qualifiedName);
        if (sym) {
            sym.calls = Array.from(callsSet);
        }
    }

    // Invert the full call graph (populate calledBy) using Set-based dedup
    const calledBySets = new Map<string, Set<string>>();
    for (const caller of newSymbols) {
        for (const calleeName of caller.calls) {
            let calledBySet = calledBySets.get(calleeName);
            if (!calledBySet) {
                calledBySet = new Set();
                calledBySets.set(calleeName, calledBySet);
            }
            calledBySet.add(caller.qualifiedName);
        }
    }
    // Assign calledBy arrays from sets
    for (const sym of newSymbols) {
        const calledBySet = calledBySets.get(sym.qualifiedName);
        sym.calledBy = calledBySet ? Array.from(calledBySet) : [];
    }

    return newSymbols;
}

/**
 * Rebuilds call graph entries for multiple changed files without inverting.
 * Used by batch processing to avoid cross-file staleness: all files are processed
 * against the same symbol set, then a single invertCallGraph pass is done by the caller.
 * Does not mutate the input array.
 */
export function rebuildCallGraphForFiles(
    project: Project,
    symbols: SymbolEntry[],
    absoluteFilePaths: string[],
    projectRoot: string
): SymbolEntry[] {
    // Create a new array with cloned objects to avoid mutating input
    const newSymbols: SymbolEntry[] = symbols.map(s => ({ ...s, calls: [...s.calls], calledBy: [...s.calledBy] }));

    // Lookup map for project symbols: qualifiedName -> SymbolEntry
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    // Use Set-based dedup to avoid O(n²) .includes() in hot loops
    const callsSets = new Map<string, Set<string>>();

    // Process all changed files against the same (complete) symbol set
    for (const absoluteFilePath of absoluteFilePaths) {
        const sourceFile = project.getSourceFile(absoluteFilePath);
        if (sourceFile) {
            processCallExpressionsInFile(sourceFile, symbolMap, newSymbols, projectRoot, callsSets);
        }
    }

    // Convert calls sets back to arrays on each symbol
    for (const [qualifiedName, callsSet] of callsSets) {
        const sym = symbolMap.get(qualifiedName);
        if (sym) {
            sym.calls = Array.from(callsSet);
        }
    }

    return newSymbols;
}

/**
 * Inverts the call graph to populate the 'calledBy' array for each symbol.
 * Does not mutate the input array.
 */
export function invertCallGraph(symbols: SymbolEntry[]): SymbolEntry[] {
    // 1. Clone symbols to avoid mutation — reset calledBy since we rebuild it below
    const newSymbols: SymbolEntry[] = symbols.map(s => ({
        ...s,
        calls: [...s.calls],
        calledBy: [],
    }));

    // 2. Build lookup map for fast access
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    // 3. Use Set-based dedup to avoid O(n²) .includes() in hot loops
    const calledBySets = new Map<string, Set<string>>();
    for (const caller of newSymbols) {
        for (const calleeName of caller.calls) {
            if (symbolMap.has(calleeName)) {
                let calledBySet = calledBySets.get(calleeName);
                if (!calledBySet) {
                    calledBySet = new Set();
                    calledBySets.set(calleeName, calledBySet);
                }
                calledBySet.add(caller.qualifiedName);
            }
        }
    }
    // Assign calledBy arrays from sets
    for (const sym of newSymbols) {
        const calledBySet = calledBySets.get(sym.qualifiedName);
        sym.calledBy = calledBySet ? Array.from(calledBySet) : [];
    }

    return newSymbols;
}
