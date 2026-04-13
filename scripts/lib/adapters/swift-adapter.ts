import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractSwiftSymbols } from '../swift/swift-symbol-extractor.js';
import { extractSwiftDeps } from '../swift/swift-dependency-extractor.js';

/**
 * Swift language adapter.
 * Uses regex-based symbol extraction. Dependency extraction uses sibling-file
 * heuristics since Swift has no file-level imports for local code.
 * Stateless — no initialization needed.
 */
export class SwiftAdapter implements LanguageAdapter {
    readonly language = 'swift';
    readonly extensions = ['.swift'];
    readonly projectMarkers = ['Package.swift'];
    readonly ignoreDirs = ['.build', 'DerivedData', 'Pods', '.swiftpm'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractSwiftSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractSwiftDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
