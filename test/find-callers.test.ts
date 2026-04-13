import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handler } from '../mcp-server/tools/find-callers.js';
import type { SymbolEntry } from '../src/types.js';

let tempKnowledgeRoot: string;

/**
 * Symbol graph:
 *   createOrder calls charge and track
 *   charge is calledBy createOrder
 *   track is calledBy createOrder
 *   notifyAdmin calls track (to test transitive callers of track)
 */
const sampleSymbols: SymbolEntry[] = [
  {
    name: 'createOrder',
    qualifiedName: 'OrderService.createOrder',
    file: 'src/order-service.ts',
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
    file: 'src/payment-service.ts',
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
    file: 'src/analytics-service.ts',
    line: 3,
    signature: 'function track(event: string): void',
    type: 'function',
    module: 'analytics-service',
    calls: [],
    calledBy: ['OrderService.createOrder', 'NotificationService.notifyAdmin'],
    throws: [],
    isExported: true,
  },
  {
    name: 'notifyAdmin',
    qualifiedName: 'NotificationService.notifyAdmin',
    file: 'src/notification-service.ts',
    line: 15,
    signature: 'function notifyAdmin(message: string): void',
    type: 'function',
    module: 'notification-service',
    calls: ['AnalyticsService.track'],
    calledBy: [],
    throws: [],
    isExported: true,
  },
];

/**
 * Circular symbol graph for cycle-detection tests:
 *   A calls B, B calls A
 */
const circularSymbols: SymbolEntry[] = [
  {
    name: 'funcA',
    qualifiedName: 'funcA',
    file: 'src/circular.ts',
    line: 1,
    signature: 'function funcA(): void',
    type: 'function',
    module: 'circular',
    calls: ['funcB'],
    calledBy: ['funcB'],
    throws: [],
    isExported: true,
  },
  {
    name: 'funcB',
    qualifiedName: 'funcB',
    file: 'src/circular.ts',
    line: 5,
    signature: 'function funcB(): void',
    type: 'function',
    module: 'circular',
    calls: ['funcA'],
    calledBy: ['funcA'],
    throws: [],
    isExported: true,
  },
];

const MINIMAL_INDEX = JSON.stringify({ lastBuilt: '2024-01-01T00:00:00Z', fileCount: 0, hasSymbols: true, hasDependencies: true });

beforeAll(async () => {
  tempKnowledgeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'find-callers-test-')
  );
  await fs.writeFile(path.join(tempKnowledgeRoot, 'index.json'), MINIMAL_INDEX, 'utf8');
  await fs.writeFile(
    path.join(tempKnowledgeRoot, 'symbols.json'),
    JSON.stringify(sampleSymbols),
    'utf8'
  );
});

afterAll(async () => {
  await fs.rm(tempKnowledgeRoot, { recursive: true, force: true });
});

describe('find_callers handler', () => {
  it('returns direct callers with file and line information', () => {
    const result = handler(
      { symbol: 'PaymentService.charge' },
      tempKnowledgeRoot
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('charge');
    expect(text).toContain('OrderService.createOrder');
    // File paths are resolved relative to project root; in test context they show as (external)
    expect(text).toContain('10');
  });

  it('is case-insensitive when matching the symbol by qualifiedName', () => {
    const resultUpper = handler(
      { symbol: 'PAYMENTSERVICE.CHARGE' },
      tempKnowledgeRoot
    );
    const resultLower = handler(
      { symbol: 'paymentservice.charge' },
      tempKnowledgeRoot
    );
    for (const result of [resultUpper, resultLower]) {
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('OrderService.createOrder');
    }
  });

  it('defaults to maxDepth 1 (direct callers only)', () => {
    // track has two callers: createOrder and notifyAdmin
    // with maxDepth=1, we only get direct callers of track
    const result = handler(
      { symbol: 'AnalyticsService.track' },
      tempKnowledgeRoot
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('OrderService.createOrder');
    expect(text).toContain('NotificationService.notifyAdmin');
    // maxDepth:1 means we do not traverse callers-of-callers
    // notifyAdmin itself has no callers, so nothing extra
  });

  it('performs BFS traversal to find transitive callers at maxDepth 2', () => {
    // charge is calledBy createOrder
    // createOrder has no callers itself
    // But track is calledBy createOrder AND notifyAdmin
    // notifyAdmin has no callers
    // At depth 2, callers of callers of track:
    //   depth 1: createOrder, notifyAdmin
    //   depth 2: callers of createOrder (none), callers of notifyAdmin (none)
    // So for a symbol with a 2-level chain, let's test charge:
    //   depth 1: createOrder
    //   depth 2: callers of createOrder (none)
    const result = handler(
      { symbol: 'PaymentService.charge', maxDepth: 2 },
      tempKnowledgeRoot
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('maxDepth: 2');
    expect(text).toContain('OrderService.createOrder');
  });

  it('returns results grouped by depth level with indentation', () => {
    // With maxDepth=2, createOrder should be at depth 1 (indented once)
    const result = handler(
      { symbol: 'PaymentService.charge', maxDepth: 2 },
      tempKnowledgeRoot
    );
    const text = result.content[0].text;
    // depth=1 results should appear with 2 spaces of indentation
    expect(text).toMatch(/  OrderService\.createOrder/);
  });

  it('prevents infinite loops on circular call graphs', async () => {
    const circularDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'find-callers-circular-')
    );
    try {
      await fs.writeFile(path.join(circularDir, 'index.json'), MINIMAL_INDEX, 'utf8');
      await fs.writeFile(
        path.join(circularDir, 'symbols.json'),
        JSON.stringify(circularSymbols),
        'utf8'
      );

      // funcA is calledBy funcB, funcB is calledBy funcA (circular)
      // BFS should not loop forever — it should complete with a finite result
      const result = handler(
        { symbol: 'funcA', maxDepth: 10 },
        circularDir
      );
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Should contain funcB as a caller at depth 1
      expect(text).toContain('funcB');
      // Should NOT recurse indefinitely — funcA itself should not re-appear
      // as a caller (it was the starting symbol and is in visited set)
      const funcACount = (text.match(/funcA/g) || []).length;
      // funcA appears in header ("Callers of funcA") but not as a result entry
      // The header line contains "funcA" once; results should only show funcB
      expect(funcACount).toBe(1); // only in the header
    } finally {
      await fs.rm(circularDir, { recursive: true, force: true });
    }
  });

  it('does not produce duplicate results in a diamond call graph', async () => {
    // Diamond: D is calledBy B and C; B and C are both calledBy A.
    // BFS from D at depth 2 should return B, C (depth 1) and A (depth 2) — each exactly once.
    const diamondSymbols: SymbolEntry[] = [
      {
        name: 'fnD', qualifiedName: 'fnD', file: 'src/d.ts', line: 1,
        signature: 'function fnD(): void', type: 'function', module: 'mod',
        calls: [], calledBy: ['fnB', 'fnC'], throws: [], isExported: true,
      },
      {
        name: 'fnB', qualifiedName: 'fnB', file: 'src/b.ts', line: 1,
        signature: 'function fnB(): void', type: 'function', module: 'mod',
        calls: ['fnD'], calledBy: ['fnA'], throws: [], isExported: true,
      },
      {
        name: 'fnC', qualifiedName: 'fnC', file: 'src/c.ts', line: 1,
        signature: 'function fnC(): void', type: 'function', module: 'mod',
        calls: ['fnD'], calledBy: ['fnA'], throws: [], isExported: true,
      },
      {
        name: 'fnA', qualifiedName: 'fnA', file: 'src/a.ts', line: 1,
        signature: 'function fnA(): void', type: 'function', module: 'mod',
        calls: ['fnB', 'fnC'], calledBy: [], throws: [], isExported: true,
      },
    ];
    const diamondDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'find-callers-diamond-')
    );
    try {
      await fs.writeFile(path.join(diamondDir, 'index.json'), MINIMAL_INDEX, 'utf8');
      await fs.writeFile(
        path.join(diamondDir, 'symbols.json'),
        JSON.stringify(diamondSymbols),
        'utf8'
      );
      const result = handler({ symbol: 'fnD', maxDepth: 2 }, diamondDir);
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Each caller should appear exactly once
      const fnBCount = (text.match(/fnB/g) || []).length;
      const fnCCount = (text.match(/fnC/g) || []).length;
      const fnACount = (text.match(/fnA/g) || []).length;
      expect(fnBCount).toBe(1);
      expect(fnCCount).toBe(1);
      expect(fnACount).toBe(1);
    } finally {
      await fs.rm(diamondDir, { recursive: true, force: true });
    }
  });

  it('returns clear message when symbol is not found', () => {
    const result = handler(
      { symbol: 'NonExistent.doesNotExist' },
      tempKnowledgeRoot
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('NonExistent.doesNotExist');
    expect(text).toContain('not found');
  });

  it('returns helpful error message when symbols.json is missing', () => {
    const result = handler(
      { symbol: 'PaymentService.charge' },
      '/nonexistent/path/to/knowledge'
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not');
  });

  it('returns a no-callers message when the symbol has no calledBy entries', () => {
    // createOrder has no calledBy entries (nothing calls it)
    const result = handler(
      { symbol: 'OrderService.createOrder' },
      tempKnowledgeRoot
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('No callers found');
    expect(text).toContain('createOrder');
  });

  it('includes qualifiedName, file and line in output for each caller', () => {
    const result = handler(
      { symbol: 'AnalyticsService.track' },
      tempKnowledgeRoot
    );
    const text = result.content[0].text;
    // createOrder is at line 10
    expect(text).toContain('OrderService.createOrder');
    expect(text).toContain('10');
  });

  it('returns helpful error when symbols.json contains corrupted JSON', async () => {
    const corruptDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'find-callers-corrupt-')
    );
    try {
      await fs.writeFile(path.join(corruptDir, 'index.json'), MINIMAL_INDEX, 'utf8');
      await fs.writeFile(
        path.join(corruptDir, 'symbols.json'),
        'not valid json {{{',
        'utf8'
      );
      const result = handler(
        { symbol: 'PaymentService.charge' },
        corruptDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not');
    } finally {
      await fs.rm(corruptDir, { recursive: true, force: true });
    }
  });
});
