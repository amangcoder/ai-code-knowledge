import type { SourceFile } from 'ts-morph';
import { Summarizer } from '../summarizer.js';
import { SymbolEntry, FileSummary, RichnessLevel, PublicAPIEntry } from '../../../src/types.js';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Detect internal patterns from file structure and symbols.
 */
function detectPatterns(filePath: string, symbols: SymbolEntry[], content: string): string[] {
    const patterns: string[] = [];
    const base = path.basename(filePath);

    // Barrel file: mostly re-exports
    const reExportCount = (content.match(/export\s+\{[^}]*\}\s+from/g) || []).length;
    const exportAllCount = (content.match(/export\s+\*\s+from/g) || []).length;
    if (reExportCount + exportAllCount >= 3) patterns.push('barrel-file');

    // Factory pattern: has function with "create" or "make" in name
    if (symbols.some(s => s.type === 'function' && /^(create|make|build)/i.test(s.name))) {
        patterns.push('factory');
    }

    // Singleton: single class with module-level instance export
    const classes = symbols.filter(s => s.type === 'class');
    if (classes.length === 1 && /export\s+(const|let)\s+\w+\s*=\s*new\s+/.test(content)) {
        patterns.push('singleton');
    }

    // Adapter/wrapper pattern
    if (base.includes('adapter') || base.includes('wrapper')) patterns.push('adapter');

    // Middleware pattern
    if (base.includes('middleware') || content.includes('(req, res, next)') || content.includes('(request, response, next)')) {
        patterns.push('middleware');
    }

    // Test file
    if (/\.(test|spec)\.[jt]sx?$/.test(base) || /^test_|_test\.py$/.test(base)) {
        patterns.push('test');
    }

    return patterns;
}

/**
 * Build a better purpose string from exports and JSDoc at standard level.
 */
function buildDetailedPurpose(filePath: string, symbols: SymbolEntry[]): string {
    const exported = symbols.filter(s => s.isExported);
    if (exported.length === 0) {
        return `Internal module with ${symbols.length} private symbol(s).`;
    }

    // Use JSDoc from the primary export if available
    const primary = exported.find(s => s.jsdoc) || exported[0];
    const jsdocSummary = primary.jsdoc
        ? primary.jsdoc.replace(/^\/\*\*\s*\n?\s*\*?\s*/m, '').replace(/\s*\*\/\s*$/m, '').split('\n')[0].replace(/^\s*\*?\s*/, '').trim()
        : undefined;

    const exportNames = exported.slice(0, 5).map(s => s.name).join(', ');
    const moreText = exported.length > 5 ? ` and ${exported.length - 5} more` : '';

    if (jsdocSummary && jsdocSummary.length > 10) {
        return `${jsdocSummary} Exports: ${exportNames}${moreText}.`;
    }

    const types = new Set(exported.map(s => s.type));
    const typeLabel = types.size === 1 ? `${[...types][0]}(s)` : 'symbols';
    return `Provides ${exported.length} exported ${typeLabel}: ${exportNames}${moreText}.`;
}

export class StaticSummarizer implements Summarizer {
    async summarizeFile(
        filePath: string,
        content: string,
        symbols: SymbolEntry[],
        sourceFile?: SourceFile,
        richness?: RichnessLevel
    ): Promise<FileSummary> {
        const isStandardPlus = richness === 'standard' || richness === 'rich';

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

        const summary: FileSummary = {
            file: filePath,
            purpose,
            exports,
            dependencies,
            sideEffects,
            throws,
            lastUpdated,
            contentHash
        };

        // Standard-level enrichment
        if (isStandardPlus) {
            summary.detailedPurpose = buildDetailedPurpose(filePath, symbols);
            summary.publicAPI = symbols
                .filter(s => s.isExported)
                .map(s => {
                    const entry: PublicAPIEntry = {
                        name: s.name,
                        type: s.type,
                        signature: s.signature,
                    };
                    if (s.jsdoc) entry.jsdoc = s.jsdoc;
                    return entry;
                });
            summary.internalPatterns = detectPatterns(filePath, symbols, content);
        }

        return summary;
    }
}

export const staticSummarizer = new StaticSummarizer();
