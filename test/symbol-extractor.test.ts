import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { extractSymbols } from '../scripts/lib/symbol-extractor.js';
import { buildCallGraph, invertCallGraph } from '../scripts/lib/call-graph.js';
import type { SymbolEntry } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/sample-project');

let project: Project;
let allSymbols: SymbolEntry[];
let symbolsWithCalls: SymbolEntry[];
let symbolsWithCalledBy: SymbolEntry[];

beforeAll(() => {
    // Create a ts-morph project using the fixture tsconfig
    project = new Project({
        tsConfigFilePath: path.join(FIXTURE_DIR, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: false,
    });

    // Extract symbols from all fixture source files
    allSymbols = [];
    for (const sourceFile of project.getSourceFiles()) {
        const symbols = extractSymbols(sourceFile, FIXTURE_DIR);
        allSymbols.push(...symbols);
    }

    // Build and invert the call graph
    symbolsWithCalls = buildCallGraph(project, allSymbols);
    symbolsWithCalledBy = invertCallGraph(symbolsWithCalls);
});

describe('extractSymbols', () => {
    it('returns at least 3 function symbols from the fixture project', () => {
        const functions = allSymbols.filter(s => s.type === 'function');
        expect(functions.length).toBeGreaterThanOrEqual(3);
    });

    it('includes createOrder, charge, and track as function symbols', () => {
        const functionNames = allSymbols
            .filter(s => s.type === 'function')
            .map(s => s.name);

        expect(functionNames).toContain('createOrder');
        expect(functionNames).toContain('charge');
        expect(functionNames).toContain('track');
    });

    it('returns at least 8 total symbols (3 functions + 4 interfaces + 1 class)', () => {
        expect(allSymbols.length).toBeGreaterThanOrEqual(8);
    });

    it('includes the PaymentDeclined class symbol', () => {
        const classes = allSymbols.filter(s => s.type === 'class');
        const classNames = classes.map(s => s.name);
        expect(classNames).toContain('PaymentDeclined');
    });

    it('includes interface symbols (Order, ChargeRequest, ChargeResult, TrackEvent)', () => {
        const interfaces = allSymbols.filter(s => s.type === 'interface');
        const interfaceNames = interfaces.map(s => s.name);
        expect(interfaceNames).toContain('Order');
        expect(interfaceNames).toContain('ChargeRequest');
        expect(interfaceNames).toContain('ChargeResult');
        expect(interfaceNames).toContain('TrackEvent');
    });

    it('sets isExported correctly for exported symbols', () => {
        const createOrder = allSymbols.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.isExported).toBe(true);
    });

    it('sets file paths as relative paths from the project root', () => {
        const createOrder = allSymbols.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        // Should be a relative path, not absolute
        expect(path.isAbsolute(createOrder!.file)).toBe(false);
        expect(createOrder!.file).toContain('order-service');
    });

    it('extracts arrow function exports as function symbols', () => {
        const formatEvent = allSymbols.find(s => s.name === 'formatEvent');
        expect(formatEvent).toBeDefined();
        expect(formatEvent!.type).toBe('function');
        expect(formatEvent!.isExported).toBe(true);
        expect(formatEvent!.file).toContain('analytics-service');
    });
});

describe('buildCallGraph', () => {
    it('does not mutate the original symbols array', () => {
        // Original allSymbols should still have empty calls arrays
        const original = allSymbols.find(s => s.name === 'createOrder');
        expect(original).toBeDefined();
        expect(original!.calls).toEqual([]);
    });

    it('shows createOrder calls charge', () => {
        const createOrder = symbolsWithCalls.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calls).toContain('charge');
    });

    it('shows createOrder calls track', () => {
        const createOrder = symbolsWithCalls.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calls).toContain('track');
    });

    it('shows charge has no calls (leaf regarding project symbols)', () => {
        const charge = symbolsWithCalls.find(s => s.name === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.calls).toHaveLength(0);
    });

    it('shows track has no calls (leaf node)', () => {
        const track = symbolsWithCalls.find(s => s.name === 'track');
        expect(track).toBeDefined();
        expect(track!.calls).toHaveLength(0);
    });

    it('shows createOrder calls formatEvent (arrow function)', () => {
        const createOrder = symbolsWithCalls.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calls).toContain('formatEvent');
    });

    it('shows formatEvent has no calls (leaf arrow function)', () => {
        const formatEvent = symbolsWithCalls.find(s => s.name === 'formatEvent');
        expect(formatEvent).toBeDefined();
        expect(formatEvent!.calls).toHaveLength(0);
    });
});

describe('invertCallGraph', () => {
    it('does not mutate the symbolsWithCalls array', () => {
        // symbolsWithCalls should still have empty calledBy arrays
        const original = symbolsWithCalls.find(s => s.name === 'charge');
        expect(original).toBeDefined();
        expect(original!.calledBy).toEqual([]);
    });

    it('shows charge is calledBy createOrder', () => {
        const charge = symbolsWithCalledBy.find(s => s.name === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.calledBy).toContain('createOrder');
    });

    it('shows track is calledBy createOrder', () => {
        const track = symbolsWithCalledBy.find(s => s.name === 'track');
        expect(track).toBeDefined();
        expect(track!.calledBy).toContain('createOrder');
    });

    it('shows formatEvent is calledBy createOrder (arrow function)', () => {
        const formatEvent = symbolsWithCalledBy.find(s => s.name === 'formatEvent');
        expect(formatEvent).toBeDefined();
        expect(formatEvent!.calledBy).toContain('createOrder');
    });

    it('shows createOrder has an empty calledBy (no callers in fixture)', () => {
        const createOrder = symbolsWithCalledBy.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calledBy).toHaveLength(0);
    });

    it('preserves calls from buildCallGraph step', () => {
        const createOrder = symbolsWithCalledBy.find(s => s.name === 'createOrder');
        expect(createOrder).toBeDefined();
        expect(createOrder!.calls).toContain('charge');
        expect(createOrder!.calls).toContain('track');
    });
});
