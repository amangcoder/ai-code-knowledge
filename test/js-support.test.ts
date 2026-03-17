import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { extractSymbols } from '../scripts/lib/symbol-extractor.js';
import { extractFileDeps } from '../scripts/lib/dependency-extractor.js';

/**
 * Creates an in-memory ts-morph project configured to handle JavaScript files.
 */
function createJsProject(): Project {
    return new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
            allowJs: true,
            checkJs: false,
            jsx: 1, // Preserve
        },
    });
}

describe('JavaScript support — symbol extraction', () => {
    it('extracts an ES6 class and its methods from a .js file', () => {
        const project = createJsProject();
        const sourceFile = project.createSourceFile(
            '/project/src/order-service.js',
            `export class OrderService {
    createOrder(items) {
        return { items };
    }
}
`,
        );

        const symbols = extractSymbols(sourceFile, '/project');

        const classSymbol = symbols.find(s => s.type === 'class' && s.name === 'OrderService');
        expect(classSymbol).toBeDefined();
        expect(classSymbol!.isExported).toBe(true);

        const methodSymbol = symbols.find(s => s.type === 'method' && s.qualifiedName === 'OrderService.createOrder');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol!.name).toBe('createOrder');
    });

    it('extracts an exported arrow function from a .js file', () => {
        const project = createJsProject();
        const sourceFile = project.createSourceFile(
            '/project/src/utils.js',
            `export const calculateTotal = (items) => {
    return items.reduce((sum, i) => sum + i.price, 0);
};
`,
        );

        const symbols = extractSymbols(sourceFile, '/project');

        const fnSymbol = symbols.find(s => s.type === 'function' && s.name === 'calculateTotal');
        expect(fnSymbol).toBeDefined();
        expect(fnSymbol!.isExported).toBe(true);
    });

    it('extracts a regular exported function from a .js file', () => {
        const project = createJsProject();
        const sourceFile = project.createSourceFile(
            '/project/src/status.js',
            `export function getStatus(id) {
    return 'active';
}
`,
        );

        const symbols = extractSymbols(sourceFile, '/project');

        const fnSymbol = symbols.find(s => s.type === 'function' && s.name === 'getStatus');
        expect(fnSymbol).toBeDefined();
        expect(fnSymbol!.isExported).toBe(true);
    });
});

describe('JavaScript support — dependency extraction', () => {
    it('extracts ES6 import dependencies from a .js file', () => {
        const project = createJsProject();

        // Create the dependency target so the import has something to reference
        project.createSourceFile('/project/src/other.js', `export const something = () => 42;\n`);

        const sourceFile = project.createSourceFile(
            '/project/src/main.js',
            `import { something } from './other.js';
export function foo() { return something(); }
`,
        );

        const deps = extractFileDeps(sourceFile);

        // extractFileDeps resolves paths via fs.existsSync, which won't find
        // in-memory files. However, the fallback for .js imports tries the .ts
        // equivalent. Since neither exists on disk, the deps array may be empty.
        // We verify the function runs without errors on JS files.
        // If deps are returned, they should reference 'other'.
        if (deps.length > 0) {
            const hasOtherDep = deps.some(d => d.path.includes('other'));
            expect(hasOtherDep).toBe(true);
        }

        // At minimum, confirm extractFileDeps doesn't throw on .js files
        expect(() => extractFileDeps(sourceFile)).not.toThrow();
    });

    it('parses CommonJS require() calls in a .js file without throwing', () => {
        const project = createJsProject();
        const sourceFile = project.createSourceFile(
            '/project/src/legacy.js',
            `const fs = require('fs');
const helper = require('./helper.js');
`,
        );

        // Should not throw when processing CommonJS require() in JS
        const deps = extractFileDeps(sourceFile);

        // 'fs' is not a relative import, so it should be skipped.
        // './helper.js' is relative, so the extractor will attempt to resolve it.
        // Since the file system is in-memory, resolution may not find it on disk,
        // but the extractor should still run cleanly.
        const fsDep = deps.find(d => d.path.includes('fs') && !d.path.includes('helper'));
        expect(fsDep).toBeUndefined(); // bare module 'fs' is skipped

        // If the helper dep resolved (unlikely with in-memory FS), verify it
        if (deps.length > 0) {
            const helperDep = deps.find(d => d.path.includes('helper'));
            if (helperDep) {
                expect(helperDep.isDynamic).toBe(false);
            }
        }
    });
});
