import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handler } from '../mcp-server/tools/get-file-summary.js';
import type { FileSummary } from '../src/types.js';

// Helper to build a tmp knowledge root with a mock cache
function createTmpKnowledgeRoot(cache: Record<string, FileSummary>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-file-summary-test-'));
  const summariesDir = path.join(tmpDir, 'summaries');
  fs.mkdirSync(summariesDir, { recursive: true });
  fs.writeFileSync(
    path.join(summariesDir, 'cache.json'),
    JSON.stringify(cache, null, 2)
  );
  return tmpDir;
}

const mockSummary: FileSummary = {
  file: 'src/types.ts',
  purpose: 'Defines shared TypeScript interfaces and types for the project.',
  exports: ['SymbolEntry', 'DependencyGraph', 'FileSummary', 'KnowledgeIndex'],
  dependencies: [],
  sideEffects: [],
  throws: [],
  lastUpdated: '2026-01-01T00:00:00.000Z',
  contentHash: 'abc123',
};

const mockCache: Record<string, FileSummary> = {
  'src/types.ts': mockSummary,
  'src/utils/helpers.ts': {
    file: 'src/utils/helpers.ts',
    purpose: 'Utility helper functions.',
    exports: ['formatDate', 'slugify'],
    dependencies: [],
    sideEffects: [],
    throws: [],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    contentHash: 'def456',
  },
  'src/services/order-service.ts': {
    file: 'src/services/order-service.ts',
    purpose: 'Handles order creation and management.',
    exports: ['createOrder', 'cancelOrder'],
    dependencies: ['src/services/payment-service.ts'],
    sideEffects: [],
    throws: ['OrderNotFoundError'],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    contentHash: 'ghi789',
  },
};

describe('get_file_summary tool', () => {
  let knowledgeRoot: string;

  beforeAll(() => {
    knowledgeRoot = createTmpKnowledgeRoot(mockCache);
  });

  afterAll(() => {
    fs.rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  describe('exact path matching', () => {
    it('returns correct FileSummary for exact path match', () => {
      const result = handler({ file: 'src/types.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
      expect(result.content[0].text).toContain('Defines shared TypeScript interfaces');
      expect(result.content[0].text).toContain('SymbolEntry');
    });

    it('formats all FileSummary fields in the output', () => {
      const result = handler({ file: 'src/types.ts' }, knowledgeRoot);
      expect(result.content[0].text).toContain('File:');
      expect(result.content[0].text).toContain('Purpose:');
      expect(result.content[0].text).toContain('Exports:');
      expect(result.content[0].text).toContain('Last Updated:');
    });
  });

  describe('path normalization', () => {
    it('strips leading ./ from path', () => {
      const result = handler({ file: './src/types.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('strips leading / from path', () => {
      const result = handler({ file: '/src/types.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('adds .ts extension when missing', () => {
      const result = handler({ file: 'src/types' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('normalizes path with both leading ./ and no extension', () => {
      const result = handler({ file: './src/types' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });
  });

  describe('partial path matching', () => {
    it('matches when input is a suffix of the cached path', () => {
      // 'types.ts' is a suffix of 'src/types.ts'
      const result = handler({ file: 'types.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('matches nested suffix path', () => {
      // 'utils/helpers.ts' is a suffix of 'src/utils/helpers.ts'
      const result = handler({ file: 'utils/helpers.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/utils/helpers.ts');
    });

    it('works with partial match + no extension', () => {
      // 'types' normalizes to 'types.ts', which is suffix of 'src/types.ts'
      const result = handler({ file: 'types' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('partial match with leading ./', () => {
      const result = handler({ file: './types.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('src/types.ts');
    });
  });

  describe('cache miss behavior', () => {
    it('returns error with list of available summaries on miss', () => {
      const result = handler({ file: 'nonexistent/file.ts' }, knowledgeRoot);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No summary found for');
      expect(result.content[0].text).toContain('nonexistent/file.ts');
    });

    it('lists available summaries on miss', () => {
      const result = handler({ file: 'nonexistent/file.ts' }, knowledgeRoot);
      expect(result.content[0].text).toContain('Available summaries');
      // Should list the available files
      expect(result.content[0].text).toContain('src/types.ts');
    });

    it('lists at most 10 available summaries', () => {
      // Create a cache with 15 entries
      const largeCache: Record<string, FileSummary> = {};
      for (let i = 0; i < 15; i++) {
        const key = `src/file${i}.ts`;
        largeCache[key] = {
          file: key,
          purpose: `File ${i}`,
          exports: [],
          dependencies: [],
          sideEffects: [],
          throws: [],
          lastUpdated: '2026-01-01T00:00:00.000Z',
          contentHash: `hash${i}`,
        };
      }
      const largeRoot = createTmpKnowledgeRoot(largeCache);
      try {
        const result = handler({ file: 'nonexistent.ts' }, largeRoot);
        expect(result.isError).toBe(true);
        // Count the entries listed (lines starting with '  - ')
        const listedEntries = result.content[0].text
          .split('\n')
          .filter((line) => line.startsWith('  - '));
        expect(listedEntries.length).toBeLessThanOrEqual(10);
      } finally {
        fs.rmSync(largeRoot, { recursive: true, force: true });
      }
    });
  });

  describe('missing cache.json', () => {
    it('returns helpful error when cache.json does not exist', () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'get-file-summary-missing-')
      );
      try {
        const result = handler({ file: 'src/types.ts' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
        expect(result.content[0].text).toContain('build-knowledge');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('path traversal prevention', () => {
    it('rejects paths containing .. segments', () => {
      const result = handler({ file: '../../etc/passwd' }, knowledgeRoot);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('path traversal');
    });

    it('rejects paths with embedded .. segments', () => {
      const result = handler({ file: 'src/../../etc/passwd' }, knowledgeRoot);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('path traversal');
    });
  });

  describe('summary output format', () => {
    it('shows throws when present', () => {
      const result = handler({ file: 'src/services/order-service.ts' }, knowledgeRoot);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Throws:');
      expect(result.content[0].text).toContain('OrderNotFoundError');
    });

    it('shows dependencies when present', () => {
      const result = handler({ file: 'src/services/order-service.ts' }, knowledgeRoot);
      expect(result.content[0].text).toContain('Dependencies:');
      expect(result.content[0].text).toContain('src/services/payment-service.ts');
    });

    it('shows (none) when no exports', () => {
      const emptyExportsCache: Record<string, FileSummary> = {
        'src/empty.ts': {
          file: 'src/empty.ts',
          purpose: 'Empty module.',
          exports: [],
          dependencies: [],
          sideEffects: [],
          throws: [],
          lastUpdated: '2026-01-01T00:00:00.000Z',
          contentHash: 'empty123',
        },
      };
      const tmpRoot = createTmpKnowledgeRoot(emptyExportsCache);
      try {
        const result = handler({ file: 'src/empty.ts' }, tmpRoot);
        expect(result.content[0].text).toContain('Exports: (none)');
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});
