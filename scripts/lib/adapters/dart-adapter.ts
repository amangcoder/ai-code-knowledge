import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractDartSymbols } from '../dart/dart-symbol-extractor.js';
import { extractDartDeps } from '../dart/dart-dependency-extractor.js';

/**
 * Dart/Flutter language adapter.
 * Uses regex-based symbol and dependency extraction (no Dart SDK required).
 * Stateless — no initialization needed.
 */
export class DartAdapter implements LanguageAdapter {
    readonly language = 'dart';
    readonly extensions = ['.dart'];
    readonly projectMarkers = ['pubspec.yaml'];
    readonly ignoreDirs = ['.dart_tool', '.pub-cache', 'build', '.flutter-plugins', '.flutter-plugins-dependencies'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractDartSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractDartDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        // Return symbols unchanged — call graph edges are not extracted for Dart yet.
        // The orchestrator runs invertCallGraph() on the merged result, so this is safe.
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
