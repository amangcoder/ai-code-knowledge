import { describe, it, expect } from 'vitest';
import { extractPythonSymbols } from '../scripts/lib/python/python-symbol-extractor.js';

const PROJECT_ROOT = '/project';
const FILE_PATH = '/project/src/service.py';

describe('extractPythonSymbols', () => {
    describe('top-level function', () => {
        it('extracts a simple top-level function with type annotations', () => {
            const source = `def hello(name: str) -> str:\n    return f"Hello {name}"\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            expect(symbols).toHaveLength(1);
            const sym = symbols[0];
            expect(sym.name).toBe('hello');
            expect(sym.qualifiedName).toBe('hello');
            expect(sym.type).toBe('function');
            expect(sym.file).toBe('src/service.py');
            expect(sym.line).toBe(1);
            expect(sym.isExported).toBe(true);
            expect(sym.language).toBe('python');
            expect(sym.signature).toContain('def hello(name: str) -> str');
        });

        it('sets module from the file path relative to project root', () => {
            const source = `def greet():\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            expect(symbols).toHaveLength(1);
            expect(symbols[0].module).toBeDefined();
        });
    });

    describe('private function (underscore prefix)', () => {
        it('marks single-underscore prefixed functions as not exported', () => {
            const source = `def _internal_helper():\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            expect(symbols).toHaveLength(1);
            const sym = symbols[0];
            expect(sym.name).toBe('_internal_helper');
            expect(sym.type).toBe('function');
            expect(sym.isExported).toBe(false);
            expect(sym.language).toBe('python');
        });

        it('marks double-underscore prefixed functions as not exported', () => {
            const source = `def __private_func():\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            expect(symbols).toHaveLength(1);
            expect(symbols[0].isExported).toBe(false);
        });
    });

    describe('class with methods', () => {
        const classSource = [
            'class OrderService:',
            '    def __init__(self, db):',
            '        self.db = db',
            '',
            '    def create_order(self, items):',
            '        pass',
            '',
            '    def _validate(self, items):',
            '        pass',
        ].join('\n');

        it('extracts the class symbol', () => {
            const symbols = extractPythonSymbols(FILE_PATH, classSource, PROJECT_ROOT);
            const classSym = symbols.find(s => s.name === 'OrderService');

            expect(classSym).toBeDefined();
            expect(classSym!.type).toBe('class');
            expect(classSym!.isExported).toBe(true);
            expect(classSym!.language).toBe('python');
            expect(classSym!.line).toBe(1);
        });

        it('extracts methods with qualified names', () => {
            const symbols = extractPythonSymbols(FILE_PATH, classSource, PROJECT_ROOT);
            const createOrder = symbols.find(s => s.name === 'create_order');

            expect(createOrder).toBeDefined();
            expect(createOrder!.qualifiedName).toBe('OrderService.create_order');
            expect(createOrder!.type).toBe('method');
        });

        it('treats __init__ (dunder method) as exported', () => {
            const symbols = extractPythonSymbols(FILE_PATH, classSource, PROJECT_ROOT);
            const initMethod = symbols.find(s => s.name === '__init__');

            expect(initMethod).toBeDefined();
            expect(initMethod!.qualifiedName).toBe('OrderService.__init__');
            expect(initMethod!.isExported).toBe(true);
        });

        it('treats underscore-prefixed methods as not exported', () => {
            const symbols = extractPythonSymbols(FILE_PATH, classSource, PROJECT_ROOT);
            const validateMethod = symbols.find(s => s.name === '_validate');

            expect(validateMethod).toBeDefined();
            expect(validateMethod!.qualifiedName).toBe('OrderService._validate');
            expect(validateMethod!.isExported).toBe(false);
        });

        it('extracts all expected symbols from the class', () => {
            const symbols = extractPythonSymbols(FILE_PATH, classSource, PROJECT_ROOT);

            // class + __init__ + create_order + _validate = 4
            expect(symbols).toHaveLength(4);
            const names = symbols.map(s => s.name);
            expect(names).toContain('OrderService');
            expect(names).toContain('__init__');
            expect(names).toContain('create_order');
            expect(names).toContain('_validate');
        });
    });

    describe('decorated function', () => {
        it('includes decorator in signature', () => {
            const source = [
                'class PaymentService:',
                '    @staticmethod',
                '    def validate_card(number: str) -> bool:',
                '        pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            const validateCard = symbols.find(s => s.name === 'validate_card');

            expect(validateCard).toBeDefined();
            expect(validateCard!.signature).toContain('@staticmethod');
        });

        it('handles multiple decorators', () => {
            const source = [
                '@app.route("/api")',
                '@require_auth',
                'def api_endpoint():',
                '    pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            const endpoint = symbols.find(s => s.name === 'api_endpoint');

            expect(endpoint).toBeDefined();
            expect(endpoint!.signature).toContain('@app.route');
            expect(endpoint!.signature).toContain('@require_auth');
        });
    });

    describe('async function', () => {
        it('extracts async functions with correct signature', () => {
            const source = `async def fetch_data(url: str) -> dict:\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            expect(symbols).toHaveLength(1);
            const sym = symbols[0];
            expect(sym.name).toBe('fetch_data');
            expect(sym.type).toBe('function');
            expect(sym.signature).toContain('async def');
            expect(sym.language).toBe('python');
        });

        it('extracts async methods inside a class', () => {
            const source = [
                'class Client:',
                '    async def connect(self, host: str) -> None:',
                '        pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            const connect = symbols.find(s => s.name === 'connect');

            expect(connect).toBeDefined();
            expect(connect!.signature).toContain('async def');
            expect(connect!.qualifiedName).toBe('Client.connect');
            expect(connect!.type).toBe('method');
        });
    });

    describe('class with bases', () => {
        it('includes base classes in the class signature', () => {
            const source = `class AdminUser(User, PermissionMixin):\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            const classSym = symbols.find(s => s.name === 'AdminUser');

            expect(classSym).toBeDefined();
            expect(classSym!.type).toBe('class');
            expect(classSym!.signature).toBe('class AdminUser(User, PermissionMixin)');
            expect(classSym!.isExported).toBe(true);
        });

        it('handles a class with no bases', () => {
            const source = `class SimpleModel:\n    pass\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            const classSym = symbols.find(s => s.name === 'SimpleModel');

            expect(classSym).toBeDefined();
            expect(classSym!.signature).toBe('class SimpleModel');
        });
    });

    describe('multiple classes and functions in one file', () => {
        it('extracts all top-level symbols and their methods', () => {
            const source = [
                'class UserService:',
                '    def get_user(self, user_id: int):',
                '        pass',
                '',
                '    def delete_user(self, user_id: int):',
                '        pass',
                '',
                'class OrderService:',
                '    def create_order(self, items):',
                '        pass',
                '',
                'def health_check() -> bool:',
                '    return True',
                '',
                'def _setup_logging():',
                '    pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            // UserService + get_user + delete_user + OrderService + create_order + health_check + _setup_logging = 7
            expect(symbols).toHaveLength(7);

            const names = symbols.map(s => s.name);
            expect(names).toContain('UserService');
            expect(names).toContain('get_user');
            expect(names).toContain('delete_user');
            expect(names).toContain('OrderService');
            expect(names).toContain('create_order');
            expect(names).toContain('health_check');
            expect(names).toContain('_setup_logging');

            // Verify types
            const classes = symbols.filter(s => s.type === 'class');
            expect(classes).toHaveLength(2);

            const methods = symbols.filter(s => s.type === 'method');
            expect(methods).toHaveLength(3);

            const functions = symbols.filter(s => s.type === 'function');
            expect(functions).toHaveLength(2);
        });

        it('assigns correct line numbers to each symbol', () => {
            const source = [
                'def first():',      // line 1
                '    pass',           // line 2
                '',                   // line 3
                'def second():',     // line 4
                '    pass',           // line 5
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            const first = symbols.find(s => s.name === 'first');
            const second = symbols.find(s => s.name === 'second');

            expect(first).toBeDefined();
            expect(first!.line).toBe(1);

            expect(second).toBeDefined();
            expect(second!.line).toBe(4);
        });
    });

    describe('empty file', () => {
        it('returns an empty array for an empty file', () => {
            const symbols = extractPythonSymbols(FILE_PATH, '', PROJECT_ROOT);
            expect(symbols).toEqual([]);
        });

        it('returns an empty array for a file with only whitespace', () => {
            const symbols = extractPythonSymbols(FILE_PATH, '   \n\n   \n', PROJECT_ROOT);
            expect(symbols).toEqual([]);
        });
    });

    describe('file with only comments', () => {
        it('returns an empty array when file has only single-line comments', () => {
            const source = [
                '# This is a comment',
                '# Another comment',
                '',
                '# Yet another comment',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            expect(symbols).toEqual([]);
        });

        it('returns an empty array when file has only docstrings and comments', () => {
            const source = [
                '"""',
                'This module does nothing yet.',
                '"""',
                '',
                '# TODO: implement later',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            expect(symbols).toEqual([]);
        });
    });

    describe('method indentation tracking', () => {
        it('treats a function at indent level 0 after a class as a top-level function, not a method', () => {
            const source = [
                'class MyService:',
                '    def service_method(self):',
                '        pass',
                '',
                'def standalone_function():',
                '    pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            const standalone = symbols.find(s => s.name === 'standalone_function');
            expect(standalone).toBeDefined();
            expect(standalone!.type).toBe('function');
            expect(standalone!.qualifiedName).toBe('standalone_function');
            // Should NOT have a class prefix in qualifiedName
            expect(standalone!.qualifiedName).not.toContain('MyService');

            const method = symbols.find(s => s.name === 'service_method');
            expect(method).toBeDefined();
            expect(method!.type).toBe('method');
            expect(method!.qualifiedName).toBe('MyService.service_method');
        });

        it('correctly handles nested classes and their methods', () => {
            const source = [
                'class Outer:',
                '    def outer_method(self):',
                '        pass',
                '',
                '    class Inner:',
                '        def inner_method(self):',
                '            pass',
                '',
                'def top_level():',
                '    pass',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            const topLevel = symbols.find(s => s.name === 'top_level');
            expect(topLevel).toBeDefined();
            expect(topLevel!.type).toBe('function');
            expect(topLevel!.qualifiedName).not.toContain('Outer');

            const outerMethod = symbols.find(s => s.name === 'outer_method');
            expect(outerMethod).toBeDefined();
            expect(outerMethod!.qualifiedName).toBe('Outer.outer_method');
        });

        it('does not confuse indented function calls with method definitions', () => {
            const source = [
                'class Config:',
                '    def load(self):',
                '        pass',
                '',
                'def initialize():',
                '    config = Config()',
                '    config.load()',
            ].join('\n');

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);

            const initialize = symbols.find(s => s.name === 'initialize');
            expect(initialize).toBeDefined();
            expect(initialize!.type).toBe('function');
            expect(initialize!.qualifiedName).toBe('initialize');
        });
    });

    describe('symbol entry structure', () => {
        it('returns symbols with all required SymbolEntry fields', () => {
            const source = `def example_func(x: int) -> str:\n    return str(x)\n`;

            const symbols = extractPythonSymbols(FILE_PATH, source, PROJECT_ROOT);
            expect(symbols).toHaveLength(1);

            const sym = symbols[0];
            expect(sym).toHaveProperty('name');
            expect(sym).toHaveProperty('qualifiedName');
            expect(sym).toHaveProperty('file');
            expect(sym).toHaveProperty('line');
            expect(sym).toHaveProperty('signature');
            expect(sym).toHaveProperty('type');
            expect(sym).toHaveProperty('module');
            expect(sym).toHaveProperty('calls');
            expect(sym).toHaveProperty('calledBy');
            expect(sym).toHaveProperty('throws');
            expect(sym).toHaveProperty('isExported');
            expect(sym).toHaveProperty('language');

            // Verify array fields are arrays
            expect(Array.isArray(sym.calls)).toBe(true);
            expect(Array.isArray(sym.calledBy)).toBe(true);
            expect(Array.isArray(sym.throws)).toBe(true);
        });
    });
});
