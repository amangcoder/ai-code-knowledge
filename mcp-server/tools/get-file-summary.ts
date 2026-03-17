import * as path from 'node:path';
import type { FileSummary, CallToolResult } from '../types.js';
import { loadSummaryCache } from './lib/data-loader.js';
import { normalizePath, findSummary, computeClosestMatches } from './lib/path-utils.js';

function formatSummary(summary: FileSummary): string {
  const lines: string[] = [];
  lines.push(`File: ${summary.file}`);
  lines.push(`Purpose: ${summary.detailedPurpose ?? summary.llmDescription ?? summary.purpose}`);

  if (summary.architecturalRole) {
    lines.push(`Architectural Role: ${summary.architecturalRole}`);
  }

  if (summary.complexityScore != null) {
    lines.push(`Complexity Score: ${summary.complexityScore}`);
  }

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

  if (summary.publicAPI && summary.publicAPI.length > 0) {
    lines.push('');
    lines.push('Public API:');
    for (const entry of summary.publicAPI) {
      let line = `  ${entry.type} ${entry.name}: ${entry.signature}`;
      if (entry.jsdoc) {
        line += `\n    ${entry.jsdoc}`;
      }
      lines.push(line);
    }
  }

  if (summary.internalPatterns && summary.internalPatterns.length > 0) {
    lines.push(`Internal Patterns: ${summary.internalPatterns.join(', ')}`);
  }

  if (summary.testFiles && summary.testFiles.length > 0) {
    lines.push(`Test Files: ${summary.testFiles.join(', ')}`);
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
  const cache = loadSummaryCache(knowledgeRoot);

  if (cache === null) {
    return {
      content: [
        {
          type: 'text',
          text: 'Knowledge base not found. The knowledge index has not been built yet for this project.',
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

  // No match found — provide top-3 closest matches
  const suggestions = computeClosestMatches(normalizedInput, cacheKeys, 3);
  const lines = [
    `No summary found for: ${args.file} (normalized: ${normalizedInput})`,
    '',
  ];

  if (suggestions.length > 0) {
    lines.push('Did you mean one of these?');
    for (const s of suggestions) {
      lines.push(`  - ${s}`);
    }
    lines.push('');
    lines.push(`Tip: Call get_file_summary(file="${suggestions[0]}") or get_implementation_context(file="${suggestions[0]}") for richer detail.`);
  } else {
    lines.push('Available summaries (first 10):');
    lines.push(...cacheKeys.slice(0, 10).map(p => `  - ${p}`));
    lines.push('');
    lines.push('Tip: Use get_batch_summaries to see all indexed files, or get_project_overview() to explore modules.');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: true,
  };
}
