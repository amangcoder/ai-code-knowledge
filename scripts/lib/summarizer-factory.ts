import { Summarizer } from './summarizer.js';
import { staticSummarizer } from './summarizers/static-summarizer.js';
import { OllamaSummarizer } from './summarizers/ollama-summarizer.js';
import { AnthropicSummarizer } from './summarizers/anthropic-summarizer.js';
import { ClaudeCodeSummarizer } from './summarizers/claude-code-summarizer.js';

/**
 * Factory function to create a Summarizer based on the SUMMARIZER_MODE environment variable.
 * Supported modes: 'static' (default), 'ollama', 'anthropic', 'claude-code'.
 */
export function createSummarizer(): Summarizer {
    const mode = process.env.SUMMARIZER_MODE || 'static';

    switch (mode.toLowerCase()) {
        case 'static':
            return staticSummarizer;
        case 'ollama':
            return new OllamaSummarizer();
        case 'anthropic':
            return new AnthropicSummarizer();
        case 'claude-code':
            return new ClaudeCodeSummarizer();
        default:
            console.warn(`[SummarizerFactory] Unknown SUMMARIZER_MODE: "${mode}". Falling back to "static".`);
            return staticSummarizer;
    }
}
