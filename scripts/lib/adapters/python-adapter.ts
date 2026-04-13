import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractPythonSymbols } from '../python/python-symbol-extractor.js';
import { extractPythonDeps } from '../python/python-dependency-extractor.js';
import { buildPythonCallGraph } from '../python/python-call-graph.js';

/**
 * Extract Python docstrings from source content and attach to symbols.
 * Looks for triple-quoted strings immediately following class/def lines.
 */
function enrichPythonSymbolsWithDocstrings(symbols: SymbolEntry[], content: string): void {
    const lines = content.split('\n');
    for (const sym of symbols) {
        const startLine = sym.line - 1; // 0-based
        // Scan lines after the def/class line for a docstring
        for (let i = startLine + 1; i < lines.length && i <= startLine + 3; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') continue;
            // Check for triple-quoted docstring
            const tripleQuote = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null;
            if (!tripleQuote) break;

            // Single-line docstring
            if (trimmed.endsWith(tripleQuote) && trimmed.length > 6) {
                sym.jsdoc = trimmed.slice(3, -3).trim();
                break;
            }
            // Multi-line docstring
            let docstring = trimmed.slice(3);
            for (let j = i + 1; j < lines.length; j++) {
                const line = lines[j];
                if (line.trimEnd().endsWith(tripleQuote)) {
                    docstring += '\n' + line.trimEnd().slice(0, -3);
                    break;
                }
                docstring += '\n' + line;
            }
            sym.jsdoc = docstring.trim();
            break;
        }
    }
}

/**
 * Python adapter. Wraps the existing regex-based Python extractors
 * behind the LanguageAdapter interface. Stateless — no initialization needed.
 */
export class PythonAdapter implements LanguageAdapter {
    readonly language = 'python';
    readonly extensions = ['.py'];
    readonly projectMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];
    readonly ignoreDirs = ['venv', '.venv', '__pycache__', '.tox', 'egg-info'];

    extractSymbols(ctx: FileContext, richness?: RichnessLevel): SymbolEntry[] {
        const symbols = extractPythonSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
        if (richness === 'standard' || richness === 'rich') {
            enrichPythonSymbolsWithDocstrings(symbols, ctx.content);
        }
        return symbols;
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractPythonDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], fileContents: Map<string, string>, projectRoot: string): SymbolEntry[] {
        return buildPythonCallGraph(symbols, fileContents, projectRoot);
    }
}
