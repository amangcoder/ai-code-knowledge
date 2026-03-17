import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractPythonSymbols } from '../python/python-symbol-extractor.js';
import { extractPythonDeps } from '../python/python-dependency-extractor.js';
import { buildPythonCallGraph } from '../python/python-call-graph.js';

/**
 * Python adapter. Wraps the existing regex-based Python extractors
 * behind the LanguageAdapter interface. Stateless — no initialization needed.
 */
export class PythonAdapter implements LanguageAdapter {
    readonly language = 'python';
    readonly extensions = ['.py'];
    readonly projectMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];
    readonly ignoreDirs = ['venv', '.venv', '__pycache__', '.tox', 'egg-info'];

    extractSymbols(ctx: FileContext): SymbolEntry[] {
        return extractPythonSymbols(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        return extractPythonDeps(ctx.filePath, ctx.content, ctx.projectRoot);
    }

    buildCallGraph(symbols: SymbolEntry[], fileContents: Map<string, string>, projectRoot: string): SymbolEntry[] {
        return buildPythonCallGraph(symbols, fileContents, projectRoot);
    }
}
