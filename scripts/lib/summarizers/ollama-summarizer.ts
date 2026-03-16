import { Summarizer, buildPrompt, parseResponse } from '../summarizer.js';
import { SymbolEntry, FileSummary } from '../../../src/types.js';
import { staticSummarizer } from './static-summarizer.js';

export class OllamaSummarizer implements Summarizer {
    constructor(
        private baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        private model = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b'
    ) { }

    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[]
    ): Promise<FileSummary> {
        const prompt = buildPrompt(filePath, content, symbols);

        let timeoutId: NodeJS.Timeout | undefined;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const err = new Error(`Ollama HTTP ${response.status}: ${response.statusText} at ${this.baseUrl}`);
                (err as any).isHttp = true;
                throw err;
            }

            const data = await response.json() as { response: string };
            const parsed = parseResponse(data.response);

            // Get static fallbacks for missing fields
            const fallback = await staticSummarizer.summarizeFile(filePath, content, symbols);

            return {
                file: filePath,
                purpose: parsed.purpose ?? fallback.purpose,
                exports: parsed.exports ?? fallback.exports,
                dependencies: parsed.dependencies ?? fallback.dependencies,
                sideEffects: parsed.sideEffects ?? fallback.sideEffects,
                throws: parsed.throws ?? fallback.throws,
                contentHash: fallback.contentHash,
                lastUpdated: fallback.lastUpdated
            };
        } catch (error: any) {
            if ((error as any).isHttp) throw error;
            if (error.name === 'AbortError') {
                throw new Error(`Ollama unreachable: timeout after 10s at ${this.baseUrl}`);
            }
            throw new Error(`Ollama unreachable: ${error.message} at ${this.baseUrl}`);
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
