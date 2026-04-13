import { Summarizer, buildPrompt, parseResponse } from '../summarizer.js';
import { SymbolEntry, FileSummary, RichnessLevel } from '../../../src/types.js';
import { staticSummarizer } from './static-summarizer.js';
import { withRetry } from '../retry.js';

function isRetryableOllamaError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'isHttp' in error) {
        const status = (error as any).status;
        return status === 429 || status >= 500;
    }
    return false;
}

export class OllamaSummarizer implements Summarizer {
    constructor(
        private baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        private model = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b'
    ) { }

    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[],
        _sourceFile?: unknown,
        richness?: RichnessLevel
    ): Promise<FileSummary> {
        const prompt = buildPrompt(filePath, content, symbols, richness);

        let timeoutId: NodeJS.Timeout | undefined;
        try {
            const data = await withRetry(async () => {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 10000);

                try {
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
                        (err as any).status = response.status;
                        throw err;
                    }

                    return await response.json() as { response: string };
                } finally {
                    clearTimeout(timeoutId);
                }
            }, { isRetryable: isRetryableOllamaError });

            const parsed = parseResponse(data.response, filePath);

            // Get static fallbacks for missing fields
            const fallback = await staticSummarizer.summarizeFile(filePath, content, symbols, undefined, richness);

            const summary: FileSummary = {
                file: filePath,
                purpose: parsed.purpose ?? fallback.purpose,
                exports: parsed.exports ?? fallback.exports,
                dependencies: parsed.dependencies ?? fallback.dependencies,
                sideEffects: parsed.sideEffects ?? fallback.sideEffects,
                throws: parsed.throws ?? fallback.throws,
                contentHash: fallback.contentHash,
                lastUpdated: fallback.lastUpdated
            };

            // Standard-level fields
            if (parsed.detailedPurpose) summary.detailedPurpose = parsed.detailedPurpose;
            else if (fallback.detailedPurpose) summary.detailedPurpose = fallback.detailedPurpose;
            if (parsed.internalPatterns) summary.internalPatterns = parsed.internalPatterns;
            else if (fallback.internalPatterns) summary.internalPatterns = fallback.internalPatterns;
            if (fallback.publicAPI) summary.publicAPI = fallback.publicAPI;

            // Rich-level fields
            if (parsed.architecturalRole) summary.architecturalRole = parsed.architecturalRole;
            if (parsed.llmDescription) summary.llmDescription = parsed.llmDescription;

            return summary;
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
