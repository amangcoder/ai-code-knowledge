import { Summarizer } from '../summarizer.js';
import { SymbolEntry, FileSummary } from '../../../src/types.js';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export class StaticSummarizer implements Summarizer {
    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[]
    ): Promise<FileSummary> {
        // a. purpose = file-name-derived
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const purpose = `${base} module`;

        // b. exports = symbols where isExported === true
        const exports = symbols
            .filter(s => s.isExported)
            .map(s => s.name);

        // c. dependencies = simple regex extraction
        const dependencyRegex = /^import .+ from ['"]([^'"]+)['"]/gm;
        const dependencies: string[] = [];
        let match;
        while ((match = dependencyRegex.exec(content)) !== null) {
            dependencies.push(match[1]);
        }

        // d. sideEffects = [] (static cannot determine)
        const sideEffects: string[] = [];

        // e. throws = symbols flatMap s.throws
        const throws = Array.from(new Set(symbols.flatMap(s => s.throws || [])));

        // f. contentHash = SHA-256
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');

        // g. lastUpdated = ISO string
        const lastUpdated = new Date().toISOString();

        return {
            file: filePath,
            purpose,
            exports,
            dependencies,
            sideEffects,
            throws,
            lastUpdated,
            contentHash
        };
    }
}

export const staticSummarizer = new StaticSummarizer();
