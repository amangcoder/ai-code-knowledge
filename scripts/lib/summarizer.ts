import { z } from 'zod';
import type { SourceFile } from 'ts-morph';
import { SymbolEntry, FileSummary } from '../../src/types.js';
import * as path from 'node:path';

/**
 * Interface for file summarization strategies.
 */
export interface Summarizer {
    summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[],
        sourceFile?: SourceFile
    ): Promise<FileSummary>
}

/**
 * Zod schema for validating LLM-generated file summary responses.
 */
export const FileSummaryResponseSchema = z.object({
    purpose: z.string(),
    exports: z.array(z.string()),
    dependencies: z.array(z.string()),
    sideEffects: z.array(z.string()),
    throws: z.array(z.string()),
}).partial();

function getLanguageInfo(filePath: string): { languageName: string; codeFence: string } {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.py': return { languageName: 'Python', codeFence: 'python' };
        case '.js': case '.jsx': case '.mjs': return { languageName: 'JavaScript', codeFence: 'javascript' };
        case '.ts': case '.tsx': default: return { languageName: 'TypeScript', codeFence: 'typescript' };
    }
}

/**
 * Builds a structured prompt for the LLM to summarize a file.
 */
export function buildPrompt(filePath: string, content: string, symbols: SymbolEntry[]): string {
    const { languageName, codeFence } = getLanguageInfo(filePath);
    const symbolList = symbols.length > 0
        ? symbols.map(s => `- ${s.name} (${s.type}): ${s.signature}`).join('\n')
        : "No symbols detected.";

    return `You are a technical documentation agent. Provide a structured summary of the following ${languageName} file.

File: ${filePath}

Content:
\`\`\`${codeFence}
${content}
\`\`\`

Extracted Symbols:
${symbolList}

Return your result as a JSON object with these fields:
1. "purpose": (string) What is the main goal of this file?
2. "exports": (string[]) What are the primary exported functions/classes?
3. "dependencies": (string[]) What internal or external modules does it import?
4. "sideEffects": (string[]) Does it perform I/O, network calls, or global state changes?
5. "throws": (string[]) What notable errors or exceptions might it throw?

Output ONLY valid JSON, no markdown, no explanation.`;
}

/**
 * Extracts and parses a JSON object from a raw LLM response.
 * Handles markdown code fences. Validates against schema and warns on issues.
 */
export function parseResponse(raw: string, filePath?: string): Partial<FileSummary> {
    try {
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
        const match = jsonBlockRegex.exec(raw);
        const jsonContent = match ? match[1] : raw;
        const parsed = JSON.parse(jsonContent.trim());

        const result = FileSummaryResponseSchema.safeParse(parsed);
        if (!result.success) {
            const truncated = raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
            process.stderr.write(
                `[summarizer] Warning: invalid LLM response for ${filePath ?? 'unknown'}:` +
                ` ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}` +
                ` | raw: ${truncated}\n`
            );
            return {
                purpose: typeof parsed.purpose === 'string' ? parsed.purpose : undefined,
                exports: Array.isArray(parsed.exports) ? parsed.exports : undefined,
                dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : undefined,
                sideEffects: Array.isArray(parsed.sideEffects) ? parsed.sideEffects : undefined,
                throws: Array.isArray(parsed.throws) ? parsed.throws : undefined,
            };
        }

        return result.data;
    } catch {
        if (raw.trim().length > 0) {
            const truncated = raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
            process.stderr.write(
                `[summarizer] Warning: failed to parse LLM response for ${filePath ?? 'unknown'}` +
                ` | raw: ${truncated}\n`
            );
        }
        return {};
    }
}
