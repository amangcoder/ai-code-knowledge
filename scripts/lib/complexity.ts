import { SourceFile, SyntaxKind, Node } from 'ts-morph';
import type { SymbolEntry } from '../../src/types.js';

/**
 * SyntaxKinds that increase cyclomatic complexity by 1.
 */
const BRANCH_KINDS = new Set([
    SyntaxKind.IfStatement,
    SyntaxKind.ConditionalExpression,     // ternary ? :
    SyntaxKind.ForStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.DoStatement,
    SyntaxKind.CaseClause,                // each case in switch
    SyntaxKind.CatchClause,
]);

/**
 * Binary operators that increase cyclomatic complexity (short-circuit evaluation).
 */
const BRANCH_OPERATORS = new Set([
    SyntaxKind.AmpersandAmpersandToken,   // &&
    SyntaxKind.BarBarToken,               // ||
    SyntaxKind.QuestionQuestionToken,     // ??
]);

/**
 * Count cyclomatic complexity of a given AST subtree.
 * Base complexity = 1, plus 1 for each branch point.
 */
function countComplexity(node: Node): number {
    let complexity = 1; // base path

    node.forEachDescendant(descendant => {
        if (BRANCH_KINDS.has(descendant.getKind())) {
            complexity++;
        }
        // Check binary expressions for &&, ||, ??
        if (descendant.getKind() === SyntaxKind.BinaryExpression) {
            const opToken = descendant.getChildAtIndex(1);
            if (opToken && BRANCH_OPERATORS.has(opToken.getKind())) {
                complexity++;
            }
        }
    });

    return complexity;
}

/**
 * Compute cyclomatic complexity for all function/method symbols in a source file
 * and attach the result to the symbol entries.
 *
 * Returns the aggregate complexity score for the file (sum of all function complexities).
 */
export function computeFileComplexity(
    sourceFile: SourceFile,
    symbols: SymbolEntry[]
): number {
    let totalComplexity = 0;

    // Build a map of line -> symbol for quick lookup
    const symbolsByLine = new Map<number, SymbolEntry>();
    for (const sym of symbols) {
        if (sym.type === 'function' || sym.type === 'method' || sym.type === 'constructor') {
            symbolsByLine.set(sym.line, sym);
        }
    }

    // Walk all function-like declarations in the source file
    const functionLikeKinds = [
        SyntaxKind.FunctionDeclaration,
        SyntaxKind.MethodDeclaration,
        SyntaxKind.ArrowFunction,
        SyntaxKind.FunctionExpression,
        SyntaxKind.Constructor,
        SyntaxKind.GetAccessor,
        SyntaxKind.SetAccessor,
    ];

    sourceFile.forEachDescendant(node => {
        if (functionLikeKinds.includes(node.getKind())) {
            const line = node.getStartLineNumber();
            const sym = symbolsByLine.get(line);
            const complexity = countComplexity(node);
            if (sym) {
                sym.complexity = complexity;
            }
            totalComplexity += complexity;
        }
    });

    return totalComplexity;
}
