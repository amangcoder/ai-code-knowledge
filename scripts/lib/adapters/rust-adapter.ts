import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractRustSymbols } from '../rust/rust-symbol-extractor.js';
import { extractRustDeps } from '../rust/rust-dependency-extractor.js';

/**
 * Rust language adapter.
 * Uses regex-based symbol and dependency extraction (no Rust toolchain required).
 * Stateless — no initialization needed.
 */
export class RustAdapter implements LanguageAdapter {
    readonly language = 'rust';
    readonly extensions = ['.rs'];
    readonly projectMarkers = ['Cargo.toml', 'Cargo.lock'];
    readonly ignoreDirs = ['target'];

    extractSymbols(ctx: FileContext, _richness?: RichnessLevel): SymbolEntry[] {
        return extractRustSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractRustDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, _projectRoot: string): SymbolEntry[] {
        return symbols.map(s => ({ ...s, calls: [...s.calls] }));
    }
}
