import { Project } from 'ts-morph';
import { extractSymbols } from './lib/symbol-extractor.js';
import { buildCallGraph, invertCallGraph } from './lib/call-graph.js';
import { extractFileDeps, type ImportInfo } from './lib/dependency-extractor.js';
import { buildDependencyGraph } from './lib/dependency-graph.js';
import { SummaryCache, getOrGenerateSummary } from './lib/summary-cache.js';
import { createSummarizer } from './lib/summarizer-factory.js';
import { atomicWrite } from './lib/atomic-writer.js';
import { buildIndex, writeIndex } from './lib/index-builder.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { SymbolEntry } from '../src/types.js';

function parseArgs(): { projectRoot: string; incremental: boolean } {
    const args = process.argv.slice(2);
    const rootIdx = args.indexOf('--root');
    const projectRoot = rootIdx !== -1
        ? path.resolve(args[rootIdx + 1])
        : process.cwd();
    const incremental = args.includes('--incremental');
    return { projectRoot, incremental };
}

function log(msg: string): void {
    process.stderr.write(`[build-knowledge] ${msg}\n`);
}

async function main(): Promise<void> {
    const { projectRoot, incremental } = parseArgs();
    const knowledgeRoot = path.join(projectRoot, '.knowledge');
    const t0 = Date.now();

    log(`mode=${incremental ? 'incremental' : 'full'} root=${projectRoot}`);

    // ── Set up ts-morph Project ───────────────────────────────────────────────
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsconfigPath);

    const project = new Project({
        tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
        skipAddingFilesFromTsConfig: false,
    });

    if (!hasTsConfig) {
        project.addSourceFilesAtPaths(path.join(projectRoot, 'src/**/*.ts'));
    }

    const sourceFiles = project.getSourceFiles();
    log(`Found ${sourceFiles.length} source files`);

    // ── Load summary cache to detect changed files ────────────────────────────
    const summaryCache = new SummaryCache(projectRoot);
    // load() returns the live internal cache reference — updates via set() are reflected here
    const cacheSnapshot = summaryCache.load();

    // Determine which files require (re-)processing
    let filesToProcess = sourceFiles;
    if (incremental) {
        filesToProcess = sourceFiles.filter(sf => {
            const hash = crypto.createHash('sha256').update(sf.getText()).digest('hex');
            const key = path.relative(projectRoot, sf.getFilePath());
            const cached = cacheSnapshot[key];
            return !cached || cached.contentHash !== hash;
        });
        log(`Incremental: ${filesToProcess.length}/${sourceFiles.length} files changed`);
    }

    // ── Phase 1: Symbol extraction ────────────────────────────────────────────
    const t1 = Date.now();
    let allSymbols: SymbolEntry[] = [];

    if (incremental && filesToProcess.length < sourceFiles.length) {
        // Seed with existing symbols, then drop entries for changed files
        const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
        if (fs.existsSync(symbolsPath)) {
            try {
                allSymbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
            } catch {
                allSymbols = [];
            }
        }
        const changedFiles = new Set(
            filesToProcess.map(sf => path.relative(projectRoot, sf.getFilePath()))
        );
        allSymbols = allSymbols.filter(s => !changedFiles.has(s.file));
    }

    for (const sf of filesToProcess) {
        allSymbols.push(...extractSymbols(sf, projectRoot));
    }

    // Rebuild call graph over all symbols for correctness
    const symbolsWithCalls = buildCallGraph(project, allSymbols);
    const finalSymbols = invertCallGraph(symbolsWithCalls);
    log(`Symbols: ${finalSymbols.length} in ${Date.now() - t1}ms`);

    await atomicWrite(
        path.join(knowledgeRoot, 'symbols.json'),
        JSON.stringify(finalSymbols, null, 2)
    );

    // ── Phase 2: Dependency graph (always full rebuild) ───────────────────────
    const t2 = Date.now();
    const fileDeps: Record<string, ImportInfo[]> = {};
    for (const sf of sourceFiles) {
        fileDeps[sf.getFilePath()] = extractFileDeps(sf);
    }
    const depGraph = buildDependencyGraph(fileDeps, projectRoot);
    log(`Dependencies: ${depGraph.nodes.length} modules, ${depGraph.cycles.length} cycles in ${Date.now() - t2}ms`);

    await atomicWrite(
        path.join(knowledgeRoot, 'dependencies.json'),
        JSON.stringify(depGraph, null, 2)
    );

    // ── Phase 3: Summary generation (only changed files) ─────────────────────
    const t3 = Date.now();
    const summarizer = createSummarizer();

    for (const sf of filesToProcess) {
        const relPath = path.relative(projectRoot, sf.getFilePath());
        const content = sf.getText();
        const fileSymbols = finalSymbols.filter(s => s.file === relPath);
        await getOrGenerateSummary(relPath, content, fileSymbols, summarizer, summaryCache);
    }

    // Write summary cache atomically (cacheSnapshot is the live internal ref)
    await atomicWrite(
        path.join(knowledgeRoot, 'summaries', 'cache.json'),
        JSON.stringify(cacheSnapshot, null, 2)
    );
    log(`Summaries: ${filesToProcess.length} processed in ${Date.now() - t3}ms`);

    // ── Phase 4: Index ────────────────────────────────────────────────────────
    const index = await buildIndex(knowledgeRoot);
    await writeIndex(knowledgeRoot, index);

    log(`Done in ${Date.now() - t0}ms total`);
}

main().catch(err => {
    process.stderr.write(`[build-knowledge] Fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
});
