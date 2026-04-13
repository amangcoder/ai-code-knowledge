import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractJavaSymbols } from '../java/java-symbol-extractor.js';
import { extractJavaDeps } from '../java/java-dependency-extractor.js';

/**
 * Java language adapter.
 * Uses regex-based symbol and dependency extraction.
 * Stateless — no initialization needed.
 */
export class JavaAdapter implements LanguageAdapter {
    readonly language = 'java';
    readonly extensions = ['.java'];
    readonly projectMarkers = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];
    readonly ignoreDirs = ['target', 'build', '.gradle', '.mvn', 'out', 'bin'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractJavaSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractJavaDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
