import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../scripts/lib/summarizer.js';
import type { SymbolEntry } from '../src/types.js';

describe('buildPrompt language detection', () => {
    it('uses TypeScript language for .ts files', () => {
        const result = buildPrompt('src/service.ts', 'const x = 1;', []);
        expect(result).toContain('TypeScript file');
        expect(result).toContain('```typescript');
    });

    it('uses Python language for .py files', () => {
        const result = buildPrompt('services/order.py', 'def hello(): pass', []);
        expect(result).toContain('Python file');
        expect(result).toContain('```python');
    });

    it('uses JavaScript language for .js files', () => {
        const result = buildPrompt('src/utils.js', 'function foo() {}', []);
        expect(result).toContain('JavaScript file');
        expect(result).toContain('```javascript');
    });

    it('uses JavaScript language for .jsx files', () => {
        const result = buildPrompt('src/App.jsx', '<div/>', []);
        expect(result).toContain('JavaScript file');
        expect(result).toContain('```javascript');
    });

    it('uses JavaScript language for .mjs files', () => {
        const result = buildPrompt('src/utils.mjs', 'export default {}', []);
        expect(result).toContain('JavaScript file');
        expect(result).toContain('```javascript');
    });

    it('uses TypeScript language for .tsx files', () => {
        const result = buildPrompt('src/App.tsx', '<div/>', []);
        expect(result).toContain('TypeScript file');
        expect(result).toContain('```typescript');
    });

    it('includes symbols in the prompt when provided', () => {
        const symbols: SymbolEntry[] = [
            {
                name: 'createOrder',
                qualifiedName: 'OrderService.createOrder',
                file: '/src/order.ts',
                line: 10,
                signature: '(items: Item[]) => Promise<Order>',
                type: 'method',
                module: 'order',
                calls: [],
                calledBy: [],
                throws: [],
                isExported: true,
            },
        ];
        const result = buildPrompt('src/order.ts', 'class OrderService {}', symbols);
        expect(result).toContain('createOrder');
        expect(result).toContain('method');
        expect(result).toContain('(items: Item[]) => Promise<Order>');
    });

    it('defaults to TypeScript for unknown extensions', () => {
        const result = buildPrompt('config.yaml', '...', []);
        expect(result).toContain('TypeScript');
    });
});
