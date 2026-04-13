import { Project, SourceFile, SyntaxKind, FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, MethodDeclaration, Node } from 'ts-morph';
import { SymbolEntry, RichnessLevel, ParameterDoc } from '../../src/types.js';
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

/**
 * Extract JSDoc text from a node's JSDoc comments.
 */
function extractJsDoc(node: Node): string | undefined {
    if (!('getJsDocs' in node)) return undefined;
    const jsDocs = (node as FunctionDeclaration).getJsDocs();
    if (!jsDocs || jsDocs.length === 0) return undefined;
    return jsDocs.map(doc => doc.getText()).join('\n').trim() || undefined;
}

/**
 * Extract parameter documentation from a function-like node.
 */
function extractParameterDocs(node: Node): ParameterDoc[] | undefined {
    if (!('getParameters' in node)) return undefined;
    const params = (node as FunctionDeclaration).getParameters();
    if (!params || params.length === 0) return undefined;

    const jsDocs = ('getJsDocs' in node) ? (node as FunctionDeclaration).getJsDocs() : [];
    const paramDescriptions = new Map<string, string>();
    for (const doc of jsDocs) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === 'param') {
                const text = tag.getText();
                // Extract @param name description
                const match = text.match(/@param\s+(?:\{[^}]*\}\s+)?(\w+)\s+(.*)/s);
                if (match) {
                    paramDescriptions.set(match[1], match[2].trim());
                }
            }
        }
    }

    return params.map(p => {
        const name = p.getName();
        let type = 'unknown';
        try {
            const typeNode = p.getTypeNode();
            type = typeNode ? typeNode.getText() : p.getType().getText();
        } catch { /* fallback */ }
        const doc: ParameterDoc = { name, type };
        if (p.isOptional()) doc.optional = true;
        const init = p.getInitializer();
        if (init) doc.defaultValue = init.getText();
        const desc = paramDescriptions.get(name);
        if (desc) doc.description = desc;
        return doc;
    });
}

/**
 * Extract return type from a function-like node.
 */
function extractReturnType(node: Node): string | undefined {
    if (!('getReturnType' in node)) return undefined;
    try {
        const returnTypeNode = (node as FunctionDeclaration).getReturnTypeNode();
        if (returnTypeNode) return returnTypeNode.getText();
        const returnType = (node as FunctionDeclaration).getReturnType();
        const text = returnType.getText();
        // Avoid overly verbose inferred types
        return text.length <= 100 ? text : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Extract decorator names from a node.
 */
function extractDecorators(node: Node): string[] | undefined {
    if (!('getDecorators' in node)) return undefined;
    const decorators = (node as ClassDeclaration).getDecorators();
    if (!decorators || decorators.length === 0) return undefined;
    return decorators.map(d => d.getText());
}

/**
 * Enrich a symbol entry with standard-level metadata (JSDoc, params, return type, decorators).
 */
function enrichSymbol(entry: SymbolEntry, node: Node): void {
    entry.jsdoc = extractJsDoc(node);
    entry.parameters = extractParameterDocs(node);
    entry.returnType = extractReturnType(node);
    entry.decorators = extractDecorators(node);
}

export function extractSymbols(sourceFile: SourceFile, projectRoot: string, richness?: RichnessLevel): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(projectRoot, filePath);
    const moduleName = path.basename(path.dirname(filePath));
    const isStandardPlus = richness === 'standard' || richness === 'rich';

    // Helper to create common properties
    const createBaseEntry = (node: Node, name: string, type: SymbolEntry['type'], qualifiedName?: string): SymbolEntry => {
        const entry: SymbolEntry = {
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
        if (isStandardPlus) {
            enrichSymbol(entry, node);
        }
        return entry;
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
                // For arrow functions assigned to vars, JSDoc may be on the variable statement
                if (isStandardPlus && !entry.jsdoc) {
                    entry.jsdoc = extractJsDoc(stmt);
                }
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
