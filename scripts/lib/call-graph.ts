import { Project, Node, SyntaxKind, CallExpression, FunctionDeclaration } from 'ts-morph';
import { SymbolEntry } from '../../src/types.js';

/**
 * Builds a call graph by identifying project symbols called by each symbol.
 * Does not mutate the input array.
 */
export function buildCallGraph(project: Project, symbols: SymbolEntry[]): SymbolEntry[] {
    // Create a new array with cloned objects to avoid mutating input
    const newSymbols: SymbolEntry[] = symbols.map(s => ({ ...s, calls: [...s.calls] }));

    // Lookup map for project symbols: qualifiedName -> SymbolEntry
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    // Iterate through all source files in the project
    for (const sourceFile of project.getSourceFiles()) {

        // Get all call expressions in the file
        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

        for (const callExpr of callExpressions) {
            // Find the enclosing function or method using AST traversal
            let enclosingFn: Node | undefined =
                callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
                callExpr.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);

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

            if (!enclosingFn) continue; // top-level call — skip

            let enclosingQualifiedName: string | undefined;
            if (Node.isMethodDeclaration(enclosingFn)) {
                const cls = enclosingFn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                if (cls) {
                    enclosingQualifiedName = `${cls.getName()}.${enclosingFn.getName()}`;
                }
            } else if (Node.isFunctionDeclaration(enclosingFn)) {
                enclosingQualifiedName = (enclosingFn as FunctionDeclaration).getName() ?? undefined;
            } else if (Node.isVariableDeclaration(enclosingFn)) {
                enclosingQualifiedName = enclosingFn.getName();
            }

            const callerSymbol = enclosingQualifiedName ? symbolMap.get(enclosingQualifiedName) : undefined;
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
                }

                // If it's one of our project symbols, add it to the caller's calls array
                if (calledQualifiedName && symbolMap.has(calledQualifiedName)) {
                    if (!callerSymbol.calls.includes(calledQualifiedName)) {
                        callerSymbol.calls.push(calledQualifiedName);
                    }
                }
            }
        }
    }

    return newSymbols;
}

/**
 * Inverts the call graph to populate the 'calledBy' array for each symbol.
 * Does not mutate the input array.
 */
export function invertCallGraph(symbols: SymbolEntry[]): SymbolEntry[] {
    // 1. Clone symbols to avoid mutation
    const newSymbols: SymbolEntry[] = symbols.map(s => ({
        ...s,
        calls: [...s.calls],
        calledBy: [...s.calledBy]
    }));

    // 2. Build lookup map for fast access
    const symbolMap = new Map<string, SymbolEntry>();
    newSymbols.forEach(s => symbolMap.set(s.qualifiedName, s));

    // 3. Iterate through symbols and populate calledBy for their callees
    for (const caller of newSymbols) {
        for (const calleeName of caller.calls) {
            const callee = symbolMap.get(calleeName);
            if (callee) {
                if (!callee.calledBy.includes(caller.qualifiedName)) {
                    callee.calledBy.push(caller.qualifiedName);
                }
            }
        }
    }

    return newSymbols;
}
