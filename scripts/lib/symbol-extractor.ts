import { Project, SourceFile, SyntaxKind, FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, MethodDeclaration, Node } from 'ts-morph';
import { SymbolEntry } from '../../src/types.js';
import * as path from 'path';

function extractSignature(text: string): string {
    const stack: string[] = [];
    const openers: Record<string, string> = { '(': ')', '<': '>', '[': ']' };
    const closers = new Set([')', '>', ']']);
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch in openers) {
            stack.push(openers[ch]);
        } else if (closers.has(ch)) {
            if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
        } else if (ch === '{') {
            if (stack.length === 0) return text.slice(0, i).trim();
            stack.push('}');
        } else if (ch === '}') {
            if (stack.length > 0 && stack[stack.length - 1] === '}') stack.pop();
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

        cls.getGetAccessors().forEach(getter => {
            const getterName = getter.getName();
            const qualifiedName = `${className}.get:${getterName}`;
            symbols.push(createBaseEntry(getter, `get:${getterName}`, 'method', qualifiedName));
        });

        cls.getSetAccessors().forEach(setter => {
            const setterName = setter.getName();
            const qualifiedName = `${className}.set:${setterName}`;
            symbols.push(createBaseEntry(setter, `set:${setterName}`, 'method', qualifiedName));
        });

        cls.getConstructors().forEach(ctor => {
            const qualifiedName = `${className}.constructor`;
            symbols.push(createBaseEntry(ctor, 'constructor', 'constructor', qualifiedName));
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

    // Enums
    sourceFile.getEnums().forEach(enumDecl => {
        const name = enumDecl.getName();
        symbols.push(createBaseEntry(enumDecl, name, 'enum'));
    });

    return symbols;
}
