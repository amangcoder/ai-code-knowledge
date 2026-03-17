import { Summarizer, buildPrompt, parseResponse } from '../summarizer.js';
import { SymbolEntry, FileSummary, RichnessLevel } from '../../../src/types.js';
import { staticSummarizer } from './static-summarizer.js';
import { withRetry } from '../retry.js';
import Anthropic from '@anthropic-ai/sdk';

function isRetryableAnthropicError(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) {
        // Retry on rate-limit (429) and server errors (500+)
        return error.status === 429 || error.status >= 500;
    }
    return false;
}

export class AnthropicSummarizer implements Summarizer {
    private client: Anthropic;

    constructor(private model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001') {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY not set');
        }
        this.client = new Anthropic({ apiKey });
    }

    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[],
        _sourceFile?: unknown,
        richness?: RichnessLevel
    ): Promise<FileSummary> {
        const prompt = buildPrompt(filePath, content, symbols, richness);

        try {
            const message = await withRetry(
                () => this.client.messages.create({
                    model: this.model,
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: prompt }]
                }),
                { isRetryable: isRetryableAnthropicError }
            );

            // Extract text from the first content block if it's a text block
            const rawText = (message.content.length > 0 && message.content[0].type === 'text')
                ? message.content[0].text
                : '';
            const parsed = parseResponse(rawText, filePath);

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
            throw new Error(`Anthropic API error: ${error.message}`, { cause: error });
        }
    }
}
