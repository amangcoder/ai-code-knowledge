import { SourceFile, SyntaxKind, StringLiteral } from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ImportInfo {
    path: string;
    isDynamic: boolean;
}

/**
 * Extracts all relative file dependencies from a SourceFile.
 * Resolves them to absolute paths.
 */
export function extractFileDeps(sourceFile: SourceFile): ImportInfo[] {
    const dependencies = new Map<string, boolean>();
    const filePath = sourceFile.getFilePath();
    const fileDir = path.dirname(filePath);

    const resolveDependency = (specifier: string, isDynamic: boolean) => {
        // Skip non-relative imports (npm packages)
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
            return;
        }

        // Resolve absolute path
        let absolutePath = path.resolve(fileDir, specifier);

        // Try to handle missing extensions (.ts, .tsx, or index.ts/index.tsx)
        const extensions = [
            '.ts', '.tsx', '/index.ts', '/index.tsx',
            '.js', '.jsx', '.mjs', '/index.js', '/index.jsx',
        ];

        const addDep = (resolvedPath: string) => {
            const existing = dependencies.get(resolvedPath);
            if (existing === undefined) {
                dependencies.set(resolvedPath, isDynamic);
            } else if (!isDynamic) {
                // Static import takes precedence
                dependencies.set(resolvedPath, false);
            }
        };

        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            addDep(absolutePath);
            return;
        }

        for (const ext of extensions) {
            const pathWithExt = absolutePath + ext;
            if (fs.existsSync(pathWithExt) && fs.statSync(pathWithExt).isFile()) {
                addDep(pathWithExt);
                return;
            }
        }

        // If we still didn't find it, just add the resolved path anyway (it might be a non-TS file or handle later)
        if (absolutePath.endsWith('.js')) {
            // Handle .js imports in TS (often used in ESM)
            const tsEquivalent = absolutePath.slice(0, -3) + '.ts';
            if (fs.existsSync(tsEquivalent)) {
                addDep(tsEquivalent);
                return;
            }
        }
    };

    // 1. Static imports
    sourceFile.getImportDeclarations().forEach(importDecl => {
        const specifier = importDecl.getModuleSpecifierValue();
        resolveDependency(specifier, false);
    });

    // 2. Dynamic imports and CommonJS require()
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(callExpr => {
        const expr = callExpr.getExpression();

        // Dynamic import: import(...)
        if (expr.getKind() === SyntaxKind.ImportKeyword) {
            const arg = callExpr.getArguments()[0];
            if (arg) {
                const kind = arg.getKind();
                if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
                    const specifier = (arg as StringLiteral).getLiteralValue();
                    resolveDependency(specifier, true);
                }
            }
        }

        // CommonJS require()
        if (expr.getText() === 'require') {
            const arg = callExpr.getArguments()[0];
            if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
                const specifier = (arg as StringLiteral).getLiteralValue();
                resolveDependency(specifier, false);
            }
        }
    });

    // 3. Export from declarations
    sourceFile.getExportDeclarations().forEach(exportDecl => {
        const specifier = exportDecl.getModuleSpecifierValue();
        if (specifier) {
            resolveDependency(specifier, false);
        }
    });

    return Array.from(dependencies.entries()).map(([resolvedPath, isDynamic]) => ({ path: resolvedPath, isDynamic }));
}
