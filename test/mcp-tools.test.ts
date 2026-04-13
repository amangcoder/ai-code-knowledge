/**
 * Integration test suite for MCP tool handlers.
 *
 * Runs build-knowledge against the sample-project fixture to produce real
 * knowledge artifacts (.knowledge/), then exercises each handler against
 * those artifacts.
 *
 * NOTE: All three fixture files live in the same directory, so the
 * module-grouper assigns them all to the 'sample-project' module.
 * Top-level functions (createOrder, charge, track) get plain names as
 * their qualifiedName — no class-prefix like 'PaymentService.charge'.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { handler as findSymbol } from '../mcp-server/tools/find-symbol.js';
import { handler as findCallers } from '../mcp-server/tools/find-callers.js';
import { handler as getDependencies } from '../mcp-server/tools/get-dependencies.js';
import { handler as getFileSummary } from '../mcp-server/tools/get-file-summary.js';
import { handler as healthCheck } from '../mcp-server/tools/health-check.js';
import { handler as searchArchitecture } from '../mcp-server/tools/search-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/sample-project');
const KNOWLEDGE_ROOT = path.join(FIXTURE_DIR, '.knowledge');

// Resolve the local tsx binary so we don't depend on a global installation.
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

const ARCHITECTURE_CONTENT = [
  '# Architecture Overview',
  '',
  '## OrderService',
  'Handles order creation and orchestrates payment and analytics.',
  'Calls charge() from payment-service and track() from analytics-service.',
  '',
  '## PaymentService',
  'Processes payment transactions. Throws PaymentDeclined on failure.',
  '',
  '## AnalyticsService',
  'Tracks user events. Leaf node with no outgoing calls.',
].join('\n');

beforeAll(async () => {
  // Build the knowledge base from the fixture project.
  execFileSync(
    TSX_BIN,
    ['scripts/build-knowledge.ts', '--root', FIXTURE_DIR],
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );

  // build-knowledge does not auto-generate architecture.md, so create a
  // synthetic one so we can test both find and no-find code paths.
  await fs.writeFile(
    path.join(KNOWLEDGE_ROOT, 'architecture.md'),
    ARCHITECTURE_CONTENT,
    'utf8'
  );
}, 30_000);

afterAll(async () => {
  // Remove the entire .knowledge directory that build-knowledge created.
  await fs.rm(KNOWLEDGE_ROOT, { recursive: true, force: true });
});

// ── find_symbol ───────────────────────────────────────────────────────────────

describe('find_symbol (integration)', () => {
  it('finds createOrder symbol', async () => {
    const result = await findSymbol({ name: 'createOrder' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('createOrder');
    expect(text).toContain('function');
  });

  it('returns an error when the knowledge base is missing', async () => {
    const result = await findSymbol({ name: 'createOrder' }, '/nonexistent/kb');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not been built');
  });
});

// ── find_callers ──────────────────────────────────────────────────────────────

describe('find_callers (integration)', () => {
  it('shows createOrder as a direct caller of charge', () => {
    // 'charge' is a top-level function; its qualifiedName is 'charge' (not
    // 'PaymentService.charge', which would apply only to a class method).
    const result = findCallers({ symbol: 'charge' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('createOrder');
  });

  it('shows createOrder as a direct caller of track', () => {
    const result = findCallers({ symbol: 'track' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('createOrder');
  });

  it('returns an error when the knowledge base is missing', () => {
    const result = findCallers({ symbol: 'charge' }, '/nonexistent/kb');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not been built');
  });
});

// ── get_dependencies ──────────────────────────────────────────────────────────

describe('get_dependencies (integration)', () => {
  it('returns the known sample-project module without error', () => {
    // All fixture files sit in the same directory, so the module-grouper
    // places them all in a single 'sample-project' module with no
    // cross-module edges.
    const result = getDependencies({ module: 'sample-project', depth: 1 }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
  });

  it('lists available modules including sample-project when an unknown module is requested', () => {
    // Querying for 'order-service' (a file name, not a module name) should
    // produce a "not found" response that enumerates the real modules.
    const result = getDependencies({ module: 'order-service', depth: 1 }, KNOWLEDGE_ROOT);
    const text = result.content[0].text;
    expect(text).toContain('not found');
    expect(text).toContain('sample-project');
  });

  it('returns an error when dependencies.json is missing', () => {
    const result = getDependencies({ module: 'sample-project', depth: 1 }, '/nonexistent/kb');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not');
  });
});

// ── get_file_summary ──────────────────────────────────────────────────────────

describe('get_file_summary (integration)', () => {
  it('returns a non-error result for order-service.ts with the file field set', () => {
    const result = getFileSummary({ file: 'order-service.ts' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    // The static summarizer sets 'file' to the relative path 'order-service.ts'
    expect(text).toContain('order-service');
  });

  it('returns an error result for a file that was never summarised', () => {
    const result = getFileSummary({ file: 'nonexistent-module.ts' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBe(true);
  });
});

// ── health_check ──────────────────────────────────────────────────────────────

describe('health_check (integration)', () => {
  it('returns a result containing Last Built and File Count', async () => {
    const result = await healthCheck({}, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Last Built');
    expect(text).toContain('File Count');
  });

  it('returns a human-readable status block with module list', async () => {
    const result = await healthCheck({}, KNOWLEDGE_ROOT);
    const text = result.content[0].text;
    expect(text).toContain('Knowledge Base Status');
    // Fixture files are at root level, so module is (root)
    expect(text).toContain('(root)');
  });
});

// ── search_architecture ───────────────────────────────────────────────────────

describe('search_architecture (integration)', () => {
  it('finds lines containing "order" in the architecture document (found path)', async () => {
    const result = await searchArchitecture({ query: 'order' }, KNOWLEDGE_ROOT);
    expect(result.isError).toBeFalsy();
    // The architecture.md contains several lines with "order" / "Order"
    const text = result.content[0].text;
    expect(text.toLowerCase()).toContain('order');
  });

  it('returns a no-results message for an unmatched query (not-found path)', async () => {
    const result = await searchArchitecture(
      { query: 'xyzzy_nonexistent_query_99999' },
      KNOWLEDGE_ROOT
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('No results found');
  });

  it('returns a no-results message when architecture.md is absent', async () => {
    const result = await searchArchitecture({ query: 'order' }, '/nonexistent/kb');
    // Handler returns no-results (not an error) when architecture.md is absent
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('No results found');
  });
});
