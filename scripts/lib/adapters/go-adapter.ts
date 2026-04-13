import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractGoSymbols } from '../go/go-symbol-extractor.js';
import { extractGoDeps } from '../go/go-dependency-extractor.js';

/**
 * Go language adapter.
 * Uses regex-based symbol and dependency extraction (no Go SDK required).
 * Stateless — no initialization needed.
 */
export class GoAdapter implements LanguageAdapter {
    readonly language = 'go';
    readonly extensions = ['.go'];
    readonly projectMarkers = ['go.mod', 'go.sum'];
    readonly ignoreDirs = ['vendor'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractGoSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractGoDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
