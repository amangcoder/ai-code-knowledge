import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handler } from '../mcp-server/tools/find-symbol.js';
import type { SymbolEntry } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tempKnowledgeRoot: string;

const sampleSymbols: SymbolEntry[] = [
    {
        name: 'createOrder',
        qualifiedName: 'OrderService.createOrder',
        file: '/project/src/order-service.ts',
        line: 10,
        signature: 'function createOrder(items: Item[]): Order',
        type: 'function',
        module: 'order-service',
        calls: ['PaymentService.charge', 'AnalyticsService.track'],
        calledBy: [],
        throws: [],
        isExported: true,
    },
    {
        name: 'charge',
        qualifiedName: 'PaymentService.charge',
        file: '/project/src/payment-service.ts',
        line: 5,
        signature: 'function charge(amount: number): void',
        type: 'function',
        module: 'payment-service',
        calls: [],
        calledBy: ['OrderService.createOrder'],
        throws: ['PaymentDeclined'],
        isExported: true,
    },
    {
        name: 'track',
        qualifiedName: 'AnalyticsService.track',
        file: '/project/src/analytics-service.ts',
        line: 3,
        signature: 'function track(event: string): void',
        type: 'function',
        module: 'analytics-service',
        calls: [],
        calledBy: ['OrderService.createOrder'],
        throws: [],
        isExported: true,
    },
    {
        name: 'Order',
        qualifiedName: 'Order',
        file: '/project/src/types.ts',
        line: 1,
        signature: 'interface Order',
        type: 'interface',
        module: 'types',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
    },
    {
        name: 'OrderStatus',
        qualifiedName: 'OrderStatus',
        file: '/project/src/types.ts',
        line: 8,
        signature: 'type OrderStatus = "pending" | "complete" | "cancelled"',
        type: 'type',
        module: 'types',
        calls: [],
        calledBy: [],
        throws: [],
        isExported: true,
    },
];

beforeAll(async () => {
    tempKnowledgeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'find-symbol-test-'));
    await fs.writeFile(
        path.join(tempKnowledgeRoot, 'symbols.json'),
        JSON.stringify(sampleSymbols),
        'utf8'
    );
});

afterAll(async () => {
    await fs.rm(tempKnowledgeRoot, { recursive: true, force: true });
});

describe('find_symbol handler', () => {
    it('returns matching entries for a known symbol name', async () => {
        const result = await handler({ name: 'createOrder' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('createOrder');
        expect(result.content[0].text).toContain('/project/src/order-service.ts');
    });

    it('performs case-insensitive substring matching', async () => {
        const resultUpper = await handler({ name: 'CREATEORDER' }, tempKnowledgeRoot);
        const resultLower = await handler({ name: 'createorder' }, tempKnowledgeRoot);
        const resultMixed = await handler({ name: 'CreateOrder' }, tempKnowledgeRoot);

        for (const result of [resultUpper, resultLower, resultMixed]) {
            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain('createOrder');
        }
    });

    it('matches by substring (partial name match)', async () => {
        // "Order" should match createOrder, Order, and OrderStatus
        const result = await handler({ name: 'order' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('createOrder');
        expect(result.content[0].text).toContain('Order');
        expect(result.content[0].text).toContain('OrderStatus');
    });

    it('sorts results by name length ascending', async () => {
        // "order" matches: createOrder (11), Order (5), OrderStatus (11)
        // sorted by length: Order (5), createOrder (11), OrderStatus (11)
        const result = await handler({ name: 'order' }, tempKnowledgeRoot);
        const text = result.content[0].text;

        const orderPos = text.indexOf('Name:      Order\n');
        const createOrderPos = text.indexOf('Name:      createOrder\n');
        const orderStatusPos = text.indexOf('Name:      OrderStatus\n');

        expect(orderPos).toBeGreaterThanOrEqual(0);
        expect(createOrderPos).toBeGreaterThanOrEqual(0);
        expect(orderStatusPos).toBeGreaterThanOrEqual(0);

        // "Order" (length 5) must appear before "createOrder" (length 11)
        expect(orderPos).toBeLessThan(createOrderPos);
        // "Order" (length 5) must appear before "OrderStatus" (length 11)
        expect(orderPos).toBeLessThan(orderStatusPos);
    });

    it('filters by optional type parameter', async () => {
        const result = await handler({ name: 'order', type: 'interface' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('Order');
        expect(result.content[0].text).not.toContain('createOrder');
        expect(result.content[0].text).not.toContain('OrderStatus');
    });

    it('type filter is case-insensitive', async () => {
        const result = await handler({ name: 'order', type: 'INTERFACE' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('Order');
        expect(result.content[0].text).not.toContain('createOrder');
    });

    it('returns no results message when nothing matches', async () => {
        const result = await handler({ name: 'nonexistentSymbol12345' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('No symbols found');
        expect(result.content[0].text).toContain('nonexistentSymbol12345');
    });

    it('returns helpful error when symbols.json does not exist', async () => {
        const result = await handler({ name: 'createOrder' }, '/nonexistent/path');
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('npm run build-knowledge');
    });

    it('limits results to 20 entries', async () => {
        // Create a large symbols array with 30 entries all matching "fn"
        const largeSymbols: SymbolEntry[] = Array.from({ length: 30 }, (_, i) => ({
            name: `fn${i}`,
            qualifiedName: `Module.fn${i}`,
            file: `/project/src/module.ts`,
            line: i + 1,
            signature: `function fn${i}(): void`,
            type: 'function' as const,
            module: 'module',
            calls: [],
            calledBy: [],
            throws: [],
            isExported: true,
        }));

        const largeTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'find-symbol-large-'));
        try {
            await fs.writeFile(
                path.join(largeTempDir, 'symbols.json'),
                JSON.stringify(largeSymbols),
                'utf8'
            );

            const result = await handler({ name: 'fn' }, largeTempDir);
            expect(result.isError).toBeFalsy();
            // Should mention "20 of 30" in the header
            expect(result.content[0].text).toContain('20');
            expect(result.content[0].text).toContain('30');
            // Should indicate there are more results
            expect(result.content[0].text).toContain('Showing first 20 of 30');
        } finally {
            await fs.rm(largeTempDir, { recursive: true, force: true });
        }
    });

    it('returns all results when under 20 matches', async () => {
        const result = await handler({ name: 'track' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('track');
        // Should not mention "Showing first 20"
        expect(result.content[0].text).not.toContain('Showing first 20');
    });

    it('includes name, type, file, line, and signature in output', async () => {
        const result = await handler({ name: 'charge' }, tempKnowledgeRoot);
        expect(result.isError).toBeFalsy();
        const text = result.content[0].text;
        expect(text).toContain('Name:');
        expect(text).toContain('Type:');
        expect(text).toContain('File:');
        expect(text).toContain('Line:');
        expect(text).toContain('Signature:');
        expect(text).toContain('charge');
        expect(text).toContain('function');
        expect(text).toContain('/project/src/payment-service.ts');
        expect(text).toContain('5');
    });
});
