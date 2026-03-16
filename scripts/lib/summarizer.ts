import { SymbolEntry, FileSummary } from '../../src/types.js';

/**
 * Interface for file summarization strategies.
 */
export interface Summarizer {
    summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[]
    ): Promise<FileSummary>
}

/**
 * Builds a structured prompt for the LLM to summarize a file.
 */
export function buildPrompt(filePath: string, content: string, symbols: SymbolEntry[]): string {
    const symbolList = symbols.length > 0
        ? symbols.map(s => `- ${s.name} (${s.type}): ${s.signature}`).join('\n')
        : "No symbols detected.";

    return `You are a technical documentation agent. Provide a structured summary of the following TypeScript file.

File: ${filePath}

Content:
\`\`\`typescript
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

Output ONLY valid JSON. Use code fences like \`\`\`json ... \`\`\`.`;
}

/**
 * Extracts and parses a JSON object from a raw LLM response.
 * Handles markdown code fences and returns an empty object on failure.
 */
export function parseResponse(raw: string): Partial<FileSummary> {
    try {
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
        const match = jsonBlockRegex.exec(raw);
        const jsonContent = match ? match[1] : raw;
        return JSON.parse(jsonContent.trim());
    } catch {
        return {};
    }
}
