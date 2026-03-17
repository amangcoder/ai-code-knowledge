import { Summarizer, buildPrompt, parseResponse } from '../summarizer.js';
import { SymbolEntry, FileSummary } from '../../../src/types.js';
import { staticSummarizer } from './static-summarizer.js';
import { withRetry } from '../retry.js';
import { execFile } from 'node:child_process';

export class ClaudeCodeSummarizer implements Summarizer {
    constructor(
        private model = process.env.CLAUDE_CODE_MODEL ?? 'sonnet'
    ) { }

    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[]
    ): Promise<FileSummary> {
        const prompt = buildPrompt(filePath, content, symbols);

        try {
            const rawText = await withRetry(
                () => this.runClaude(prompt),
                {
                    isRetryable: (err) => {
                        const msg = (err as Error).message ?? '';
                        return msg.includes('rate') || msg.includes('timeout') || msg.includes('ECONNRESET');
                    }
                }
            );
            const parsed = parseResponse(rawText, filePath);

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
            throw new Error(`Claude Code error: ${error.message}`);
        }
    }

    private runClaude(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = ['--print', '--model', this.model];
            const child = execFile('claude', args, {
                maxBuffer: 1024 * 1024,
                timeout: 60_000,
                env: { ...process.env }
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`claude CLI failed: ${error.message}${stderr ? ` — ${stderr}` : ''}`));
                    return;
                }
                resolve(stdout);
            });

            child.stdin?.write(prompt);
            child.stdin?.end();
        });
    }
}
