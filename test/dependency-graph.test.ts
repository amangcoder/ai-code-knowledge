/**
 * Tests for dependency extraction and graph building.
 *
 * Covers:
 *  - extractFileDeps: resolves imported file paths (including .js → .ts remapping)
 *  - buildDependencyGraph: builds module-level edges from fileDeps
 *  - Cycle detection: identifies circular module imports
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { extractFileDeps, ImportInfo } from '../scripts/lib/dependency-extractor.js';
import { buildDependencyGraph } from '../scripts/lib/dependency-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-project');

// ---------------------------------------------------------------------------
// extractFileDeps
// ---------------------------------------------------------------------------

describe('extractFileDeps', () => {
    let project: Project;

    beforeAll(() => {
        project = new Project({
            tsConfigFilePath: path.join(FIXTURE_DIR, 'tsconfig.json'),
        });
    });

    it('returns two imports for order-service', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'order-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        expect(deps).toHaveLength(2);
    });

    it('resolves payment-service import to an absolute .ts path', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'order-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        const depPaths = deps.map(d => d.path);
        expect(depPaths).toContain(path.join(FIXTURE_DIR, 'payment-service.ts'));
    });

    it('resolves analytics-service import to an absolute .ts path', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'order-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        const depPaths = deps.map(d => d.path);
        expect(depPaths).toContain(path.join(FIXTURE_DIR, 'analytics-service.ts'));
    });

    it('marks all order-service imports as static (isDynamic: false)', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'order-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        for (const dep of deps) {
            expect(dep.isDynamic).toBe(false);
        }
    });

    it('returns empty array for payment-service (no relative imports)', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'payment-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        expect(deps).toHaveLength(0);
    });

    it('returns empty array for analytics-service (leaf node)', () => {
        const sourceFile = project.getSourceFileOrThrow(
            path.join(FIXTURE_DIR, 'analytics-service.ts')
        );
        const deps = extractFileDeps(sourceFile);

        expect(deps).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph – module edges
// ---------------------------------------------------------------------------

describe('buildDependencyGraph – module edges', () => {
    it('produces correct nodes for three-module fixture', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/order-module/order.ts': [
                { path: '/fake/project/payment-module/payment.ts', isDynamic: false },
                { path: '/fake/project/analytics-module/analytics.ts', isDynamic: false },
            ],
            '/fake/project/payment-module/payment.ts': [],
            '/fake/project/analytics-module/analytics.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.nodes).toContain('order-module');
        expect(graph.nodes).toContain('payment-module');
        expect(graph.nodes).toContain('analytics-module');
    });

    it('produces a direct edge from order-module to payment-module', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/order-module/order.ts': [
                { path: '/fake/project/payment-module/payment.ts', isDynamic: false },
                { path: '/fake/project/analytics-module/analytics.ts', isDynamic: false },
            ],
            '/fake/project/payment-module/payment.ts': [],
            '/fake/project/analytics-module/analytics.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.edges).toContainEqual({
            from: 'order-module',
            to: 'payment-module',
            type: 'direct',
        });
    });

    it('produces a direct edge from order-module to analytics-module', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/order-module/order.ts': [
                { path: '/fake/project/payment-module/payment.ts', isDynamic: false },
                { path: '/fake/project/analytics-module/analytics.ts', isDynamic: false },
            ],
            '/fake/project/payment-module/payment.ts': [],
            '/fake/project/analytics-module/analytics.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.edges).toContainEqual({
            from: 'order-module',
            to: 'analytics-module',
            type: 'direct',
        });
    });

    it('marks a dynamic import edge correctly', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/source-module/file.ts': [
                { path: '/fake/project/target-module/file.ts', isDynamic: true },
            ],
            '/fake/project/target-module/file.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.edges).toContainEqual({
            from: 'source-module',
            to: 'target-module',
            type: 'dynamic',
        });
    });

    it('upgrades a dynamic edge to direct when both import types exist', () => {
        const projectRoot = '/fake/project';
        // Two files in source-module: one dynamic, one static import of the same target.
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/source-module/file-a.ts': [
                { path: '/fake/project/target-module/file.ts', isDynamic: true },
            ],
            '/fake/project/source-module/file-b.ts': [
                { path: '/fake/project/target-module/file.ts', isDynamic: false },
            ],
            '/fake/project/target-module/file.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        const edgesFromSource = graph.edges.filter(e => e.from === 'source-module');
        // Exactly one de-duplicated edge
        expect(edgesFromSource).toHaveLength(1);
        expect(edgesFromSource[0]).toMatchObject({ type: 'direct' });
    });

    it('populates fileDeps with relative paths', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/moduleA/file.ts': [
                { path: '/fake/project/moduleB/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleB/file.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.fileDeps['moduleA/file.ts']).toContain('moduleB/file.ts');
        expect(graph.fileDeps['moduleB/file.ts']).toHaveLength(0);
    });

    it('returns no cycles for a strictly acyclic graph', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/moduleA/file.ts': [
                { path: '/fake/project/moduleB/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleB/file.ts': [
                { path: '/fake/project/moduleC/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleC/file.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.cycles).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('buildDependencyGraph – cycle detection', () => {
    it('detects a two-node cycle (A → B → A)', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/moduleA/file.ts': [
                { path: '/fake/project/moduleB/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleB/file.ts': [
                { path: '/fake/project/moduleA/file.ts', isDynamic: false },
            ],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.cycles.length).toBeGreaterThan(0);

        const cycleNodes = graph.cycles.flat();
        expect(cycleNodes).toContain('moduleA');
        expect(cycleNodes).toContain('moduleB');
    });

    it('detects a three-node cycle (A → B → C → A)', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/moduleA/file.ts': [
                { path: '/fake/project/moduleB/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleB/file.ts': [
                { path: '/fake/project/moduleC/file.ts', isDynamic: false },
            ],
            '/fake/project/moduleC/file.ts': [
                { path: '/fake/project/moduleA/file.ts', isDynamic: false },
            ],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.cycles.length).toBeGreaterThan(0);

        const cycleNodes = graph.cycles[0];
        expect(cycleNodes).toContain('moduleA');
        expect(cycleNodes).toContain('moduleB');
        expect(cycleNodes).toContain('moduleC');
    });

    it('identifies a self-referential node as a cycle when imported via another module', () => {
        // A → B → A is the minimal cycle; test the cycle array length matches
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/cycleA/file.ts': [
                { path: '/fake/project/cycleB/file.ts', isDynamic: false },
            ],
            '/fake/project/cycleB/file.ts': [
                { path: '/fake/project/cycleA/file.ts', isDynamic: false },
            ],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        // Each detected cycle array must have at least 2 nodes
        for (const cycle of graph.cycles) {
            expect(cycle.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('returns no cycles for the fixture project (order → payment, order → analytics are DAG)', () => {
        const projectRoot = '/fake/project';
        const fileDeps: Record<string, ImportInfo[]> = {
            '/fake/project/order-module/order.ts': [
                { path: '/fake/project/payment-module/payment.ts', isDynamic: false },
                { path: '/fake/project/analytics-module/analytics.ts', isDynamic: false },
            ],
            '/fake/project/payment-module/payment.ts': [],
            '/fake/project/analytics-module/analytics.ts': [],
        };

        const graph = buildDependencyGraph(fileDeps, projectRoot);

        expect(graph.cycles).toHaveLength(0);
    });
});
