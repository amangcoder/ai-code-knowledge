import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CallToolResult } from '../types.js';

const CONTEXT_LINES = 3;

export interface SearchArchitectureArgs {
  query: string;
}

/**
 * Merges overlapping or adjacent line ranges into consolidated ranges.
 * Each range is [start, end] inclusive (0-based indices).
 */
function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current[0] <= last[1] + 1) {
      // Overlapping or adjacent — extend the last range
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

export async function handler(
  args: SearchArchitectureArgs,
  knowledgeRoot: string
): Promise<CallToolResult> {
  const architecturePath = path.join(knowledgeRoot, 'architecture.md');

  let content: string;
  try {
    content = fs.readFileSync(architecturePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        content: [
          {
            type: 'text',
            text:
              'architecture.md not found. Run "npm run build-knowledge" to generate the knowledge artifacts, ' +
              'or create .knowledge/architecture.md manually.',
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Error reading architecture.md: ${(err as Error).message}` }],
      isError: true,
    };
  }

  const lines = content.split('\n');
  const query = args.query.toLowerCase();

  // Find all lines that match the query (0-based indices)
  const matchingIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(query)) {
      matchingIndices.push(i);
    }
  }

  if (matchingIndices.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No matching architecture content found',
        },
      ],
    };
  }

  // Build context ranges (clamped to valid line indices)
  const contextRanges: Array<[number, number]> = matchingIndices.map((idx) => [
    Math.max(0, idx - CONTEXT_LINES),
    Math.min(lines.length - 1, idx + CONTEXT_LINES),
  ]);

  // Merge overlapping windows
  const mergedRanges = mergeRanges(contextRanges);

  // Build result string — each line prefixed with [architecture.md:LINE_NUMBER]
  // Line numbers are 1-based for human readability
  const resultParts: string[] = [];
  for (const [start, end] of mergedRanges) {
    const block: string[] = [];
    for (let i = start; i <= end; i++) {
      block.push(`[architecture.md:${i + 1}] ${lines[i]}`);
    }
    resultParts.push(block.join('\n'));
  }

  return {
    content: [
      {
        type: 'text',
        text: resultParts.join('\n\n'),
      },
    ],
  };
}
