import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileSummary } from '../types.js';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function normalizePath(filePath: string): string {
  // Strip leading ./ or /
  let normalized = filePath.replace(/^\.\//, '').replace(/^\//, '');
  // Block path traversal attempts
  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed');
  }
  // Ensure .ts extension if no extension present
  if (!path.extname(normalized)) {
    normalized = normalized + '.ts';
  }
  return normalized;
}

function loadCache(knowledgeRoot: string): Record<string, FileSummary> | null {
  const cachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(data) as Record<string, FileSummary>;
  } catch (err) {
    console.error('[GetFileSummaryTool] Failed to parse cache.json:', err);
    return null;
  }
}

function formatSummary(summary: FileSummary): string {
  const lines: string[] = [];
  lines.push(`File: ${summary.file}`);
  lines.push(`Purpose: ${summary.purpose}`);

  if (summary.exports && summary.exports.length > 0) {
    lines.push(`Exports: ${summary.exports.join(', ')}`);
  } else {
    lines.push('Exports: (none)');
  }

  if (summary.dependencies && summary.dependencies.length > 0) {
    lines.push(`Dependencies: ${summary.dependencies.join(', ')}`);
  } else {
    lines.push('Dependencies: (none)');
  }

  if (summary.sideEffects && summary.sideEffects.length > 0) {
    lines.push(`Side Effects: ${summary.sideEffects.join(', ')}`);
  }

  if (summary.throws && summary.throws.length > 0) {
    lines.push(`Throws: ${summary.throws.join(', ')}`);
  }

  if (summary.lastUpdated) {
    lines.push(`Last Updated: ${summary.lastUpdated}`);
  }

  return lines.join('\n');
}

export function handler(
  args: { file: string },
  knowledgeRoot: string = '.knowledge'
): CallToolResult {
  const cache = loadCache(knowledgeRoot);

  if (cache === null) {
    const cachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    return {
      content: [
        {
          type: 'text',
          text: `Error: Summary cache not found at ${cachePath}.\nRun 'npm run build-knowledge' to generate the knowledge artifacts first.`,
        },
      ],
      isError: true,
    };
  }

  let normalizedInput: string;
  try {
    normalizedInput = normalizePath(args.file);
  } catch {
    return {
      content: [{ type: 'text', text: 'Invalid file path: path traversal is not allowed.' }],
      isError: true,
    };
  }

  // Try exact match first
  if (cache[normalizedInput]) {
    return {
      content: [{ type: 'text', text: formatSummary(cache[normalizedInput]) }],
    };
  }

  // Try partial match: input is a suffix of a cached path
  const cacheKeys = Object.keys(cache);
  const partialMatch = cacheKeys.find(
    (key) => key === normalizedInput || key.endsWith('/' + normalizedInput)
  );

  if (partialMatch) {
    return {
      content: [{ type: 'text', text: formatSummary(cache[partialMatch]) }],
    };
  }

  // No match found - list first 10 available paths
  const available = cacheKeys.slice(0, 10);
  const availableList =
    available.length > 0
      ? available.map((p) => `  - ${p}`).join('\n')
      : '  (no summaries available)';

  return {
    content: [
      {
        type: 'text',
        text: [
          `No summary found for: ${args.file} (normalized: ${normalizedInput})`,
          '',
          'Available summaries (first 10):',
          availableList,
        ].join('\n'),
      },
    ],
    isError: true,
  };
}
