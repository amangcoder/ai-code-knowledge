import { Project, SourceFile, SyntaxKind, FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, MethodDeclaration, Node } from 'ts-morph';
import { SymbolEntry } from '../../src/types.js';
import * as path from 'path';

function extractSignature(text: string): string {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(' || text[i] === '<' || text[i] === '[') {
            depth++;
        } else if (text[i] === ')' || text[i] === '>' || text[i] === ']') {
            depth--;
        } else if (text[i] === '{') {
            if (depth === 0) return text.slice(0, i).trim();
            depth++;
        } else if (text[i] === '}') {
            depth--;
        }
    }
    return text.trim();
}

export function extractSymbols(sourceFile: SourceFile, projectRoot: string): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(projectRoot, filePath);
    const moduleName = path.basename(path.dirname(filePath));

    // Helper to create common properties
    const createBaseEntry = (node: Node, name: string, type: SymbolEntry['type'], qualifiedName?: string): SymbolEntry => {
        return {
            name,
            qualifiedName: qualifiedName || name,
            file: relativePath,
            line: node.getStartLineNumber(),
            signature: type === 'class' ? `class ${name}` : extractSignature(node.getText()),
            type,
            module: moduleName,
            calls: [],
            calledBy: [],
            throws: [],
            isExported: 'isExported' in node && typeof (node as Record<string, unknown>).isExported === 'function' ? (node as { isExported(): boolean }).isExported() : false
        };
    };

    // Functions
    sourceFile.getFunctions().forEach(func => {
        const name = func.getName() || `anonymous_${func.getStartLineNumber()}`;
        symbols.push(createBaseEntry(func, name, 'function'));
    });

    // Arrow functions and function expressions assigned to variables
    sourceFile.getVariableStatements().forEach(stmt => {
        stmt.getDeclarations().forEach(decl => {
            const init = decl.getInitializer();
            if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                const name = decl.getName();
                const entry = createBaseEntry(init, name, 'function');
                entry.isExported = stmt.isExported();
                symbols.push(entry);
            }
        });
    });

    // Classes
    sourceFile.getClasses().forEach(cls => {
        const className = cls.getName() || 'AnonymousClass';
        symbols.push(createBaseEntry(cls, className, 'class'));

        cls.getMethods().forEach(method => {
            const methodName = method.getName();
            const qualifiedName = `${className}.${methodName}`;
            symbols.push(createBaseEntry(method, methodName, 'method', qualifiedName));
        });
    });

    // Interfaces
    sourceFile.getInterfaces().forEach(iface => {
        const name = iface.getName();
        symbols.push(createBaseEntry(iface, name, 'interface'));
    });

    // Type Aliases
    sourceFile.getTypeAliases().forEach(typeAlias => {
        const name = typeAlias.getName();
        symbols.push(createBaseEntry(typeAlias, name, 'type'));
    });

    return symbols;
}
