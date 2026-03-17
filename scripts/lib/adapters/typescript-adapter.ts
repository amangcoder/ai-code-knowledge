import * as path from 'node:path';
import * as fs from 'node:fs';
import { Project, SourceFile } from 'ts-morph';
import type { LanguageAdapter, FileContext } from './language-adapter.js';
import type { SymbolEntry, RichnessLevel } from '../../../src/types.js';
import type { ImportInfo } from '../dependency-extractor.js';
import { extractSymbols } from '../symbol-extractor.js';
import { buildCallGraph, rebuildCallGraphForFile, rebuildCallGraphForFiles } from '../call-graph.js';
import { extractFileDeps } from '../dependency-extractor.js';

/**
 * TypeScript/JavaScript adapter. Wraps the existing ts-morph-based extractors
 * behind the LanguageAdapter interface. Handles both TS and JS via allowJs.
 */
export class TypeScriptAdapter implements LanguageAdapter {
    readonly language = 'typescript';
    readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
    readonly projectMarkers = ['tsconfig.json', 'package.json'];
    readonly ignoreDirs = ['node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage'];

    private project: Project | undefined;
    private projectRoot: string = '';

    /** Get the internal ts-morph Project (for incremental use cases). */
    getProject(): Project | undefined {
        return this.project;
    }

    async initialize(filePaths: string[], projectRoot: string): Promise<void> {
        this.projectRoot = projectRoot;
        const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
        const hasTsConfig = fs.existsSync(tsconfigPath);

        this.project = new Project({
            tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
            skipAddingFilesFromTsConfig: !hasTsConfig,
            compilerOptions: {
                allowJs: true,
                checkJs: false,
                jsx: 1, // ts.JsxEmit.Preserve
            },
        });

        if (!hasTsConfig) {
            // Add files explicitly when no tsconfig
            for (const fp of filePaths) {
                this.project.addSourceFileAtPath(fp);
            }
        }

        // Fallback: if tsconfig exists but yielded 0 files
        if (hasTsConfig && this.project.getSourceFiles().length === 0) {
            const ignoreGlobs = this.ignoreDirs.map(d => `!${path.join(projectRoot, `**/${d}/**`)}`);
            const hasTs = filePaths.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
            const hasJs = filePaths.some(f => f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.mjs'));
            if (hasTs) this.project.addSourceFilesAtPaths([path.join(projectRoot, '**/*.{ts,tsx}'), ...ignoreGlobs]);
            if (hasJs) this.project.addSourceFilesAtPaths([path.join(projectRoot, '**/*.{js,jsx,mjs}'), ...ignoreGlobs]);
        }
    }

    extractSymbols(ctx: FileContext, richness?: RichnessLevel): SymbolEntry[] {
        if (!this.project) {
            throw new Error('TypeScriptAdapter: initialize() must be called before extractSymbols()');
        }

        let sourceFile = this.project.getSourceFile(ctx.filePath);
        if (!sourceFile) {
            sourceFile = this.project.addSourceFileAtPath(ctx.filePath);
        }

        const symbols = extractSymbols(sourceFile, ctx.projectRoot, richness);
        const lang = this.detectSubLanguage(ctx.filePath);
        symbols.forEach(s => s.language = lang);
        return symbols;
    }

    extractDependencies(ctx: FileContext): ImportInfo[] {
        if (!this.project) {
            throw new Error('TypeScriptAdapter: initialize() must be called before extractDependencies()');
        }

        let sourceFile = this.project.getSourceFile(ctx.filePath);
        if (!sourceFile) {
            sourceFile = this.project.addSourceFileAtPath(ctx.filePath);
        }

        return extractFileDeps(sourceFile);
    }

    buildCallGraph(symbols: SymbolEntry[], _fileContents: Map<string, string>, projectRoot: string): SymbolEntry[] {
        if (!this.project) {
            throw new Error('TypeScriptAdapter: initialize() must be called before buildCallGraph()');
        }
        return buildCallGraph(this.project, symbols, projectRoot);
    }

    /**
     * Rebuild call graph for a single file (incremental update).
     * This is a TS-specific optimization that the orchestrator can use directly.
     */
    rebuildCallGraphForFile(symbols: SymbolEntry[], absoluteFilePath: string, projectRoot: string): SymbolEntry[] {
        if (!this.project) {
            throw new Error('TypeScriptAdapter: initialize() must be called first');
        }
        return rebuildCallGraphForFile(this.project, symbols, absoluteFilePath, projectRoot);
    }

    /**
     * Rebuild call graph for multiple files (batch incremental update).
     */
    rebuildCallGraphForFiles(symbols: SymbolEntry[], absoluteFilePaths: string[], projectRoot: string): SymbolEntry[] {
        if (!this.project) {
            throw new Error('TypeScriptAdapter: initialize() must be called first');
        }
        return rebuildCallGraphForFiles(this.project, symbols, absoluteFilePaths, projectRoot);
    }

    /** Returns all source files from the ts-morph Project. */
    getSourceFiles(): SourceFile[] {
        return this.project?.getSourceFiles() ?? [];
    }

    dispose(): void {
        this.project = undefined;
    }

    /** Distinguish TypeScript from JavaScript based on file extension. */
    private detectSubLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.js' || ext === '.jsx' || ext === '.mjs') return 'javascript';
        return 'typescript';
    }
}
