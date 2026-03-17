import { describe, it, expect } from 'vitest';
import { buildPythonCallGraph } from '../scripts/lib/python/python-call-graph.js';
import type { SymbolEntry } from '../src/types.js';

function makeSymbol(overrides: Partial<SymbolEntry> & { name: string; qualifiedName: string; file: string }): SymbolEntry {
    return {
        line: 1,
        signature: '',
        type: 'function',
        module: 'test',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
        language: 'python',
        ...overrides,
    };
}

const PROJECT_ROOT = '/project';

describe('buildPythonCallGraph', () => {
    it('detects a simple function call (A calls B)', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'a', qualifiedName: 'a', file: 'app.py', line: 1 }),
            makeSymbol({ name: 'b', qualifiedName: 'b', file: 'app.py', line: 4 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def a():',
            '    b()',
            '',
            'def b():',
            '    pass',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const a = result.find(s => s.name === 'a');
        const b = result.find(s => s.name === 'b');
        expect(a).toBeDefined();
        expect(a!.calls).toContain('b');
        expect(b).toBeDefined();
        expect(b!.calls).toHaveLength(0);
    });

    it('detects a method call (ClassName.method)', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'bar', qualifiedName: 'Foo.bar', file: 'app.py', line: 3, type: 'method' }),
            makeSymbol({ name: 'main', qualifiedName: 'main', file: 'app.py', line: 6 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'class Foo:',
            '    def bar(self):',
            '        pass',
            '',
            'def main():',
            '    foo = Foo()',
            '    foo.bar()',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        // The regex matches `Foo.bar(` via METHOD_CALL_RE only when the object
        // name matches the class name exactly. Here `foo.bar(` has object `foo`
        // (lowercase), so METHOD_CALL_RE produces `foo.bar` which won't match
        // the known symbol `Foo.bar`. However SIMPLE_CALL_RE will match `bar(`
        // and since there's a symbol named `bar` (qualifiedName `Foo.bar`), it
        // will be linked via the name index.
        const main = result.find(s => s.name === 'main');
        expect(main).toBeDefined();
        expect(main!.calls).toContain('Foo.bar');
    });

    it('does not create false positives for unknown functions', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'a', qualifiedName: 'a', file: 'app.py', line: 1 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def a():',
            '    unknown_function()',
            '    also_not_real(42)',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const a = result.find(s => s.name === 'a');
        expect(a).toBeDefined();
        expect(a!.calls).toHaveLength(0);
    });

    it('does not mutate the input symbols array', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'a', qualifiedName: 'a', file: 'app.py', line: 1 }),
            makeSymbol({ name: 'b', qualifiedName: 'b', file: 'app.py', line: 4 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def a():',
            '    b()',
            '',
            'def b():',
            '    pass',
        ].join('\n'));

        // Snapshot original calls arrays
        const originalACalls = [...symbols[0].calls];
        const originalBCalls = [...symbols[1].calls];

        buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        expect(symbols[0].calls).toEqual(originalACalls);
        expect(symbols[1].calls).toEqual(originalBCalls);
    });

    it('returns an empty array when given empty symbols list', () => {
        const symbols: SymbolEntry[] = [];
        const fileContents = new Map<string, string>();

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        expect(result).toEqual([]);
    });

    it('creates a module-init symbol for top-level calls to known functions', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'setup', qualifiedName: 'setup', file: 'app.py', line: 1 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def setup():',
            '    pass',
            '',
            'setup()',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const moduleInit = result.find(s => s.type === 'module-init');
        expect(moduleInit).toBeDefined();
        expect(moduleInit!.qualifiedName).toBe('<module-init:app.py>');
        expect(moduleInit!.calls).toContain('setup');
    });

    it('ignores Python keywords that look like function calls', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'process', qualifiedName: 'process', file: 'app.py', line: 1 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def process():',
            '    if (True):',
            '        return(1)',
            '        pass',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const process = result.find(s => s.name === 'process');
        expect(process).toBeDefined();
        // 'if' and 'return' are Python keywords and should not appear as calls
        expect(process!.calls).toHaveLength(0);
    });

    it('handles multiple functions calling each other', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'a', qualifiedName: 'a', file: 'app.py', line: 1 }),
            makeSymbol({ name: 'b', qualifiedName: 'b', file: 'app.py', line: 4 }),
            makeSymbol({ name: 'c', qualifiedName: 'c', file: 'app.py', line: 7 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def a():',
            '    b()',
            '    c()',
            'def b():',
            '    c()',
            '',
            'def c():',
            '    pass',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const a = result.find(s => s.name === 'a');
        const b = result.find(s => s.name === 'b');
        const c = result.find(s => s.name === 'c');

        expect(a!.calls).toContain('b');
        expect(a!.calls).toContain('c');
        expect(b!.calls).toContain('c');
        expect(c!.calls).toHaveLength(0);
    });

    it('does not add duplicate calls when a function is called multiple times', () => {
        const symbols: SymbolEntry[] = [
            makeSymbol({ name: 'a', qualifiedName: 'a', file: 'app.py', line: 1 }),
            makeSymbol({ name: 'b', qualifiedName: 'b', file: 'app.py', line: 5 }),
        ];

        const fileContents = new Map<string, string>();
        fileContents.set('/project/app.py', [
            'def a():',
            '    b()',
            '    b()',
            '    b()',
            'def b():',
            '    pass',
        ].join('\n'));

        const result = buildPythonCallGraph(symbols, fileContents, PROJECT_ROOT);

        const a = result.find(s => s.name === 'a');
        expect(a!.calls).toEqual(['b']);
    });
});
