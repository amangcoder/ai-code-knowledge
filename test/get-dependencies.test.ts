import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handler } from '../mcp-server/tools/get-dependencies.js';
import type { DependencyGraph } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(overrides?: Partial<DependencyGraph>): DependencyGraph {
  return {
    nodes: ['orders', 'payments', 'analytics', 'notifications'],
    edges: [
      { from: 'orders', to: 'payments', type: 'direct' },
      { from: 'orders', to: 'analytics', type: 'direct' },
      { from: 'payments', to: 'notifications', type: 'dynamic' },
      { from: 'analytics', to: 'notifications', type: 'direct' },
    ],
    cycles: [],
    fileDeps: {},
    ...overrides,
  };
}

function createTempKnowledge(graph: DependencyGraph): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-deps-test-'));
  fs.writeFileSync(
    path.join(tmpDir, 'dependencies.json'),
    JSON.stringify(graph),
    'utf-8'
  );
  return tmpDir;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('get_dependencies tool', () => {
  let knowledgeRoot: string;

  beforeAll(() => {
    knowledgeRoot = createTempKnowledge(makeGraph());
  });

  afterAll(() => {
    fs.rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  // ── Missing file ────────────────────────────────────────────────────────────

  it('returns helpful error when dependencies.json is missing', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-deps-empty-'));
    try {
      const result = handler({ module: 'orders' }, emptyDir);
      const text = result.content[0].text;
      expect(text).toContain('dependencies.json not found');
      expect(text).toContain('npm run build-knowledge');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // ── Module not found ────────────────────────────────────────────────────────

  it('lists available modules when requested module is not found', () => {
    const result = handler({ module: 'unknown-module' }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('not found');
    // All available modules should be listed
    expect(text).toContain('orders');
    expect(text).toContain('payments');
    expect(text).toContain('analytics');
    expect(text).toContain('notifications');
  });

  // ── Direct dependencies (depth = 1, default) ────────────────────────────────

  it('returns direct dependencies at default depth (1)', () => {
    const result = handler({ module: 'orders' }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('payments');
    expect(text).toContain('analytics');
    // transitive dep should NOT appear at depth 1
    expect(text).not.toContain('notifications');
  });

  it('returns direct dependencies when depth is explicitly 1', () => {
    const result = handler({ module: 'orders', depth: 1 }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('payments');
    expect(text).toContain('analytics');
    expect(text).not.toContain('notifications');
  });

  // ── Transitive dependencies (depth = 2) ─────────────────────────────────────

  it('returns transitive dependencies at depth 2', () => {
    const result = handler({ module: 'orders', depth: 2 }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('payments');
    expect(text).toContain('analytics');
    expect(text).toContain('notifications');
  });

  // ── Dynamic import type label ────────────────────────────────────────────────

  it('marks dynamic imports in the output', () => {
    // payments -> notifications is dynamic
    const result = handler({ module: 'payments', depth: 1 }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('[dynamic]');
  });

  // ── Leaf node (no outgoing edges) ────────────────────────────────────────────

  it('reports no dependencies for a leaf node', () => {
    const result = handler({ module: 'notifications' }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('no dependencies');
  });

  // ── Cycle safety ─────────────────────────────────────────────────────────────

  it('does not loop infinitely when cycles are present', () => {
    const cyclicGraph = makeGraph({
      nodes: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b', type: 'direct' },
        { from: 'b', to: 'c', type: 'direct' },
        { from: 'c', to: 'a', type: 'direct' }, // cycle back
      ],
    });
    const tmpDir = createTempKnowledge(cyclicGraph);
    try {
      // depth=10 would loop forever without visited tracking
      const result = handler({ module: 'a', depth: 10 }, tmpDir);
      const text = result.content[0].text;
      // Should have finished and returned some deps
      expect(text).toContain('b');
      expect(text).toContain('c');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Correct output format ────────────────────────────────────────────────────

  it('includes module name and depth in output header', () => {
    const result = handler({ module: 'orders', depth: 2 }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('"orders"');
    expect(text).toContain('depth: 2');
  });

  // ── No modules available edge case ──────────────────────────────────────────

  it('handles empty nodes list gracefully', () => {
    const emptyGraph = makeGraph({ nodes: [], edges: [] });
    const tmpDir = createTempKnowledge(emptyGraph);
    try {
      const result = handler({ module: 'orders' }, tmpDir);
      const text = result.content[0].text;
      expect(text).toContain('not found');
      expect(text).toContain('No modules are currently indexed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns helpful error when dependencies.json contains corrupted JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-deps-corrupt-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'dependencies.json'),
        'not valid json {{{',
        'utf-8'
      );
      const result = handler({ module: 'orders' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('npm run build-knowledge');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
