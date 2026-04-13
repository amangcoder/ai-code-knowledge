import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectProjectLanguages, detectLanguage } from '../scripts/lib/language-detection.js';
import { extractPythonSymbols } from '../scripts/lib/python/python-symbol-extractor.js';
import { invertCallGraph } from '../scripts/lib/call-graph.js';
import type { SymbolEntry } from '../src/types.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'multi-lang-build-test-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

describe('Mixed project detection', () => {
    it('detects all three languages when tsconfig.json, requirements.txt, and package.json are present', () => {
        writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
        writeFileSync(path.join(tempDir, 'requirements.txt'), '');
        writeFileSync(path.join(tempDir, 'package.json'), '{}');

        const languages = detectProjectLanguages(tempDir);

        expect(languages).toContain('typescript');
        expect(languages).toContain('javascript');
        expect(languages).toContain('python');
        expect(languages).toHaveLength(3);
    });
});

describe('Python + TS symbol merge', () => {
    it('merges Python and TypeScript symbols and runs invertCallGraph without errors', () => {
        // Create a simple Python file and extract symbols
        const pyDir = path.join(tempDir, 'services');
        mkdirSync(pyDir, { recursive: true });
        const pyFile = path.join(pyDir, 'user_service.py');
        writeFileSync(pyFile, [
            'class UserService:',
            '    def get_user(self, user_id: str) -> dict:',
            '        return {}',
            '',
            'def list_users() -> list:',
            '    return []',
        ].join('\n'));

        const pythonSymbols = extractPythonSymbols(pyFile, readFileSync(pyFile, 'utf-8'), tempDir);

        // Manually create TypeScript-like SymbolEntry objects
        const tsSymbols: SymbolEntry[] = [
            {
                name: 'AuthService',
                qualifiedName: 'AuthService',
                file: 'src/auth.ts',
                line: 1,
                signature: 'class AuthService',
                type: 'class',
                module: 'src',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: true,
                language: 'typescript',
            },
            {
                name: 'login',
                qualifiedName: 'AuthService.login',
                file: 'src/auth.ts',
                line: 5,
                signature: 'login(username: string, password: string): Promise<boolean>',
                type: 'method',
                module: 'src',
                calls: ['list_users'],
                calledBy: [],
                throws: [],
                isExported: true,
                language: 'typescript',
            },
        ];

        // Merge both sets
        const merged = [...pythonSymbols, ...tsSymbols];

        // Verify both sets are present
        const qualifiedNames = merged.map(s => s.qualifiedName);
        expect(qualifiedNames).toContain('UserService');
        expect(qualifiedNames).toContain('UserService.get_user');
        expect(qualifiedNames).toContain('list_users');
        expect(qualifiedNames).toContain('AuthService');
        expect(qualifiedNames).toContain('AuthService.login');

        // Verify Python symbols have language: 'python'
        for (const sym of pythonSymbols) {
            expect(sym.language).toBe('python');
        }

        // Run invertCallGraph on merged set without errors
        const inverted = invertCallGraph(merged);

        expect(inverted).toHaveLength(merged.length);

        // AuthService.login calls list_users, so list_users should have calledBy populated
        const listUsersInverted = inverted.find(s => s.qualifiedName === 'list_users');
        expect(listUsersInverted).toBeDefined();
        expect(listUsersInverted!.calledBy).toContain('AuthService.login');
    });
});

describe('Language detection per file', () => {
    it('detects python for .py files', () => {
        expect(detectLanguage('service.py')).toBe('python');
    });

    it('detects typescript for .ts files', () => {
        expect(detectLanguage('service.ts')).toBe('typescript');
    });

    it('detects javascript for .js files', () => {
        expect(detectLanguage('service.js')).toBe('javascript');
    });

    it('detects javascript for .jsx files', () => {
        expect(detectLanguage('service.jsx')).toBe('javascript');
    });
});

describe('Python symbols extracted correctly from fixture', () => {
    it('extracts expected symbols from order_service.py', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/sample-python-project/order_service.py');
        const fixtureRoot = path.resolve(__dirname, 'fixtures/sample-python-project');
        const content = readFileSync(fixturePath, 'utf-8');

        const symbols = extractPythonSymbols(fixturePath, content, fixtureRoot);

        const qualifiedNames = symbols.map(s => s.qualifiedName);

        // Has class OrderService
        expect(qualifiedNames).toContain('OrderService');

        // Has methods like OrderService.create_order
        expect(qualifiedNames).toContain('OrderService.create_order');
        expect(qualifiedNames).toContain('OrderService.__init__');
        expect(qualifiedNames).toContain('OrderService._calculate_total');
        expect(qualifiedNames).toContain('OrderService.process_payment');

        // Has standalone function get_order_status
        expect(qualifiedNames).toContain('get_order_status');

        // All symbols have language: 'python'
        for (const sym of symbols) {
            expect(sym.language).toBe('python');
        }

        // Verify types are correct
        const orderServiceClass = symbols.find(s => s.qualifiedName === 'OrderService');
        expect(orderServiceClass!.type).toBe('class');

        const createOrder = symbols.find(s => s.qualifiedName === 'OrderService.create_order');
        expect(createOrder!.type).toBe('method');

        const getOrderStatus = symbols.find(s => s.qualifiedName === 'get_order_status');
        expect(getOrderStatus!.type).toBe('function');
    });
});
