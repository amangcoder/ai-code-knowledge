import type { SourceFile } from 'ts-morph';
import { Summarizer } from '../summarizer.js';
import { SymbolEntry, FileSummary } from '../../../src/types.js';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export class StaticSummarizer implements Summarizer {
    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[],
        sourceFile?: SourceFile
    ): Promise<FileSummary> {
        // a. purpose = file-name-derived
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const purpose = `${base} module`;

        // b. exports = symbols where isExported === true
        const exports = symbols
            .filter(s => s.isExported)
            .map(s => s.name);

        // c. dependencies = use ts-morph when available, regex fallback
        const dependencies: string[] = [];
        if (sourceFile) {
            for (const imp of sourceFile.getImportDeclarations()) {
                dependencies.push(imp.getModuleSpecifierValue());
            }
        } else {
            if (filePath.endsWith('.py')) {
                // Python imports
                const pyImportRegex = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
                let match;
                while ((match = pyImportRegex.exec(content)) !== null) {
                    dependencies.push(match[1] || match[2]);
                }
            } else {
                // ES6 imports
                const esImportRegex = /^import .+ from ['"]([^'"]+)['"]/gm;
                let match;
                while ((match = esImportRegex.exec(content)) !== null) {
                    dependencies.push(match[1]);
                }
                // CommonJS require
                const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
                while ((match = requireRegex.exec(content)) !== null) {
                    dependencies.push(match[1]);
                }
            }
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
