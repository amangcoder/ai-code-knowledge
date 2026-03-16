import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handler } from '../mcp-server/tools/search-architecture.js';

let tmpDir: string;
let knowledgeRoot: string;

const SAMPLE_ARCHITECTURE = `# Architecture Overview

## Components

### OrderService
Handles order creation and lifecycle management.
Calls PaymentService.charge and AnalyticsService.track.

### PaymentService
Processes payment transactions.
Throws PaymentDeclined on insufficient funds.

### AnalyticsService
Tracks user events and metrics.
Leaf node with no outgoing service calls.

## Data Flow

The OrderService orchestrates the flow:
1. Validate the order
2. Charge the customer via PaymentService
3. Track the event via AnalyticsService
`;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-arch-test-'));
  knowledgeRoot = tmpDir;
  fs.writeFileSync(path.join(knowledgeRoot, 'architecture.md'), SAMPLE_ARCHITECTURE, 'utf-8');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('search_architecture handler', () => {
  it('finds a case-insensitive match for an exact lowercase query', async () => {
    const result = await handler({ query: 'paymentservice' }, knowledgeRoot);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('PaymentService');
  });

  it('returns line number prefixes in [architecture.md:N] format', async () => {
    const result = await handler({ query: 'OrderService' }, knowledgeRoot);
    const text = result.content[0].text;
    // Every output line should start with the prefix
    const outputLines = text.split('\n').filter((l) => l.trim() !== '');
    for (const line of outputLines) {
      expect(line).toMatch(/^\[architecture\.md:\d+\]/);
    }
  });

  it('includes 3 lines of context before and after each match', async () => {
    // "Throws PaymentDeclined" is on a known line; context should include surrounding lines
    const result = await handler({ query: 'PaymentDeclined' }, knowledgeRoot);
    const text = result.content[0].text;
    // The context should include the line above (Processes payment transactions)
    expect(text).toContain('Processes payment transactions');
    // And the line below (blank or AnalyticsService section)
    expect(text).toContain('AnalyticsService');
  });

  it('merges overlapping context windows when matches are close together', async () => {
    // "PaymentService" appears in multiple close lines — windows should merge
    const result = await handler({ query: 'PaymentService' }, knowledgeRoot);
    const text = result.content[0].text;
    // Should produce a single merged block (no double blank lines between parts
    // that would indicate separate windows when not necessary)
    expect(result.content[0].type).toBe('text');
    // Ensure no duplicate line numbers
    const lineNumMatches = [...text.matchAll(/\[architecture\.md:(\d+)\]/g)];
    const lineNums = lineNumMatches.map((m) => m[1]);
    const uniqueLineNums = new Set(lineNums);
    expect(lineNums.length).toBe(uniqueLineNums.size);
  });

  it('returns "No matching architecture content found" when query has no matches', async () => {
    const result = await handler({ query: 'xyzzy_nonexistent_token' }, knowledgeRoot);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('No matching architecture content found');
  });

  it('returns a helpful error when architecture.md is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-arch-miss-'));
    try {
      const result = await handler({ query: 'anything' }, emptyDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('architecture.md not found');
      expect(result.content[0].text).toContain('npm run build-knowledge');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('handles a query that matches the very first line without context overflow', async () => {
    const result = await handler({ query: 'Architecture Overview' }, knowledgeRoot);
    const text = result.content[0].text;
    expect(text).toContain('[architecture.md:1]');
    // Should not have a line [architecture.md:0] (1-based, no underflow)
    expect(text).not.toContain('[architecture.md:0]');
  });

  it('handles a query that matches the last line without context overflow', async () => {
    const lines = SAMPLE_ARCHITECTURE.split('\n');
    // Find the last non-empty line text
    const lastNonEmpty = [...lines].reverse().find((l) => l.trim() !== '') ?? '';
    const result = await handler({ query: lastNonEmpty.trim() }, knowledgeRoot);
    const text = result.content[0].text;
    expect(result.isError).toBeFalsy();
    // Should not contain a line number beyond the total line count
    const lineNumMatches = [...text.matchAll(/\[architecture\.md:(\d+)\]/g)];
    const maxLineNum = Math.max(...lineNumMatches.map((m) => parseInt(m[1], 10)));
    expect(maxLineNum).toBeLessThanOrEqual(lines.length);
  });
});
