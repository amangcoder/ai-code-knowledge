import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractKotlinSymbols } from '../kotlin/kotlin-symbol-extractor.js';
import { extractKotlinDeps } from '../kotlin/kotlin-dependency-extractor.js';

/**
 * Kotlin language adapter.
 * Uses regex-based symbol and dependency extraction.
 * Stateless — no initialization needed.
 */
export class KotlinAdapter implements LanguageAdapter {
    readonly language = 'kotlin';
    readonly extensions = ['.kt', '.kts'];
    readonly projectMarkers = ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts'];
    readonly ignoreDirs = ['build', '.gradle', 'out', 'bin'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractKotlinSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractKotlinDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
