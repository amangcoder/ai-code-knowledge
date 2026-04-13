import { Summarizer } from './summarizer.js';
import { staticSummarizer } from './summarizers/static-summarizer.js';
import { OllamaSummarizer } from './summarizers/ollama-summarizer.js';
import { AnthropicSummarizer } from './summarizers/anthropic-summarizer.js';
import { ClaudeCodeSummarizer } from './summarizers/claude-code-summarizer.js';
import type { RichnessLevel } from '../../src/types.js';

/**
 * Factory function to create a Summarizer based on the SUMMARIZER_MODE environment variable.
 * Supported modes: 'static' (default), 'ollama', 'anthropic', 'claude-code'.
 *
 * At 'rich' richness with 'static' mode, warns that LLM-dependent fields will be empty.
 */
export function createSummarizer(richness?: RichnessLevel): Summarizer {
    const mode = process.env.SUMMARIZER_MODE || 'static';

    if (richness === 'rich' && mode === 'static') {
        process.stderr.write(
            '[SummarizerFactory] Warning: richness=rich but SUMMARIZER_MODE=static. ' +
            'LLM-dependent fields (llmDescription, architecturalRole) will be empty. ' +
            'Set SUMMARIZER_MODE=anthropic|ollama|claude-code for full richness.\n'
        );
    }

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
