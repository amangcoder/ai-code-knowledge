import { invertCallGraph } from './lib/call-graph.js';
import type { ImportInfo } from './lib/dependency-extractor.js';
import { buildDependencyGraph } from './lib/dependency-graph.js';
import { SummaryCache, getOrGenerateSummary } from './lib/summary-cache.js';
import { createSummarizer } from './lib/summarizer-factory.js';
import { atomicWrite } from './lib/atomic-writer.js';
import { buildIndex, writeIndex } from './lib/index-builder.js';
import { createDefaultRegistry, TypeScriptAdapter } from './lib/adapters/index.js';
import { collectSourceFiles } from './lib/file-collector.js';
import type { FileContext } from './lib/adapters/language-adapter.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { SymbolEntry, RichnessLevel } from '../src/types.js';
import type { ModuleConfig } from './lib/module-grouper.js';

const VALID_RICHNESS: RichnessLevel[] = ['minimal', 'standard', 'rich'];

function parseArgs(): { projectRoot: string; incremental: boolean; richness?: RichnessLevel } {
    const args = process.argv.slice(2);
    const rootIdx = args.indexOf('--root');
    const projectRoot = rootIdx !== -1
        ? path.resolve(args[rootIdx + 1])
        : process.cwd();
    const incremental = args.includes('--incremental');

    // Richness: CLI flag > env var > config.json (resolved later) > default 'minimal'
    const richnessIdx = args.indexOf('--richness');
    let richness: RichnessLevel | undefined;
    if (richnessIdx !== -1 && args[richnessIdx + 1]) {
        const val = args[richnessIdx + 1] as RichnessLevel;
        if (VALID_RICHNESS.includes(val)) {
            richness = val;
        } else {
            log(`Warning: invalid --richness "${args[richnessIdx + 1]}", ignoring`);
        }
    }
    if (!richness) {
        const envVal = process.env.KNOWLEDGE_RICHNESS as RichnessLevel | undefined;
        if (envVal && VALID_RICHNESS.includes(envVal)) {
            richness = envVal;
        }
    }

    return { projectRoot, incremental, richness };
}

function log(msg: string): void {
    process.stderr.write(`[build-knowledge] ${msg}\n`);
}

async function main(): Promise<void> {
    const { projectRoot, incremental, richness: cliRichness } = parseArgs();
    const knowledgeRoot = path.join(projectRoot, '.knowledge');
    const t0 = Date.now();

    // Mark build as in-progress for crash detection
    const indexPath = path.join(knowledgeRoot, 'index.json');
    let buildGeneration = 0;
    if (fs.existsSync(indexPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            buildGeneration = (existing.buildGeneration ?? 0) + 1;
        } catch { /* ignore */ }
    }
    fs.mkdirSync(knowledgeRoot, { recursive: true });
    await atomicWrite(indexPath, JSON.stringify({ buildInProgress: true, buildGeneration }, null, 2));

    // ── Load optional module config ───────────────────────────────────────────
    let moduleConfig: ModuleConfig | undefined;
    const configPath = path.join(knowledgeRoot, 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            moduleConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ModuleConfig;
            log(`Loaded module config from ${configPath}`);
        } catch {
            log(`Warning: failed to parse ${configPath}, using defaults`);
        }
    }

    // ── Resolve richness level: CLI > env > config > default ─────────────────
    const richness: RichnessLevel = cliRichness
        ?? moduleConfig?.richness
        ?? 'minimal';
    log(`mode=${incremental ? 'incremental' : 'full'} richness=${richness} root=${projectRoot}`);

    // ── Set up adapter registry and detect languages ──────────────────────────
    const registry = createDefaultRegistry();
    const languages = registry.detectProjectLanguages(projectRoot);
    log(`Detected languages: ${languages.join(', ') || 'none'}`);

    // ── Collect source files grouped by language ──────────────────────────────
    const filesByLanguage = collectSourceFiles(projectRoot, registry);
    let totalFiles = 0;
    for (const [lang, files] of filesByLanguage) {
        log(`Found ${files.length} ${lang} files`);
        totalFiles += files.length;
    }

    // ── Initialize adapters ───────────────────────────────────────────────────
    for (const [lang, files] of filesByLanguage) {
        const adapter = registry.getByLanguage(lang);
        if (adapter?.initialize) {
            await adapter.initialize(files.map(f => f.filePath), projectRoot);
        }
    }

    // ── Load summary cache to detect changed files ────────────────────────────
    const summaryCache = new SummaryCache(projectRoot);
    const cacheSnapshot = summaryCache.load();

    // ── Determine which files need processing (incremental mode) ──────────────
    // For incremental mode, filter to only changed files per language
    const filesToProcess = new Map<string, FileContext[]>();
    const allFileContexts = new Map<string, FileContext[]>();

    for (const [lang, files] of filesByLanguage) {
        allFileContexts.set(lang, files);
        if (incremental) {
            const changed = files.filter(f => {
                const hash = crypto.createHash('sha256').update(f.content).digest('hex');
                const cached = cacheSnapshot[f.relativePath];
                return !cached || cached.contentHash !== hash;
            });
            filesToProcess.set(lang, changed);
            if (changed.length < files.length) {
                log(`Incremental [${lang}]: ${changed.length}/${files.length} files changed`);
            }
        } else {
            filesToProcess.set(lang, files);
        }
    }

    // ── Phase 1: Symbol extraction ────────────────────────────────────────────
    const t1 = Date.now();
    let allSymbols: SymbolEntry[] = [];

    // In incremental mode, load existing symbols and remove entries for changed files
    if (incremental) {
        const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
        if (fs.existsSync(symbolsPath)) {
            try {
                allSymbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
            } catch {
                allSymbols = [];
            }
        }
        const changedFiles = new Set<string>();
        for (const [, files] of filesToProcess) {
            for (const f of files) {
                changedFiles.add(f.relativePath);
            }
        }
        allSymbols = allSymbols.filter(s => !changedFiles.has(s.file));
    }

    // Extract symbols per language using adapters
    for (const [lang, files] of filesToProcess) {
        const adapter = registry.getByLanguage(lang)!;
        for (const file of files) {
            allSymbols.push(...adapter.extractSymbols(file, richness));
        }
    }

    // ── Build call graphs per language, then merge ────────────────────────────
    let symbolsWithCalls: SymbolEntry[] = [];

    for (const [lang, files] of allFileContexts) {
        const adapter = registry.getByLanguage(lang)!;
        const langSymbols = allSymbols.filter(s => s.language === lang ||
            (lang === 'typescript' && s.language === 'javascript'));

        if (langSymbols.length === 0) continue;

        const contents = new Map<string, string>();
        for (const f of files) {
            contents.set(f.relativePath, f.content);
        }

        const withCalls = adapter.buildCallGraph(langSymbols, contents, projectRoot);
        symbolsWithCalls.push(...withCalls);
    }

    const finalSymbols = invertCallGraph(symbolsWithCalls);
    log(`Symbols: ${finalSymbols.length} in ${Date.now() - t1}ms`);

    // ── Phase 2: Dependency graph (always full rebuild) ───────────────────────
    const t2 = Date.now();
    const fileDeps: Record<string, ImportInfo[]> = {};

    for (const [lang, files] of allFileContexts) {
        const adapter = registry.getByLanguage(lang)!;
        for (const file of files) {
            fileDeps[file.filePath] = adapter.extractDependencies(file);
        }
    }

    const depGraph = buildDependencyGraph(fileDeps, projectRoot, moduleConfig);
    log(`Dependencies: ${depGraph.nodes.length} modules, ${depGraph.cycles.length} cycles in ${Date.now() - t2}ms`);

    await atomicWrite(
        path.join(knowledgeRoot, 'dependencies.json'),
        JSON.stringify(depGraph, null, 2)
    );

    // ── Phase 2.5: Rich-level analysis (complexity + test mapping) ────────────
    if (richness === 'rich') {
        const t25 = Date.now();

        // Complexity analysis
        const { computeFileComplexity } = await import('./lib/complexity.js');
        const tsAdapterForComplexity = registry.getByLanguage('typescript') as TypeScriptAdapter | undefined;
        const project = tsAdapterForComplexity?.getProject();
        if (project) {
            const allRelFiles = new Set<string>();
            for (const [, files] of allFileContexts) {
                for (const f of files) allRelFiles.add(f.relativePath);
            }
            // Compute complexity per source file
            for (const sf of project.getSourceFiles()) {
                const rel = path.relative(projectRoot, sf.getFilePath());
                if (!allRelFiles.has(rel)) continue;
                const fileSymbols = finalSymbols.filter(s => s.file === rel);
                if (fileSymbols.length > 0) {
                    computeFileComplexity(sf, fileSymbols);
                }
            }
        }

        // Test mapping
        const { buildTestMap } = await import('./lib/test-mapper.js');
        const allFiles: string[] = [];
        for (const [, files] of allFileContexts) {
            for (const f of files) allFiles.push(f.relativePath);
        }
        const testMap = buildTestMap(allFiles, depGraph.fileDeps);

        // Store test map for Phase 3 to use
        (depGraph as any)._testMap = testMap;

        log(`Rich analysis (complexity + test mapping) in ${Date.now() - t25}ms`);
    }

    // ── Write symbols (after Phase 2.5 so complexity data is included) ───────
    await atomicWrite(
        path.join(knowledgeRoot, 'symbols.json'),
        JSON.stringify(finalSymbols, null, 2)
    );

    // ── Phase 3: Summary generation (only changed files) ─────────────────────
    const t3 = Date.now();
    const summarizer = createSummarizer(richness);

    // For TS/JS files, pass the SourceFile for richer summarization if available
    const tsAdapter = registry.getByLanguage('typescript') as TypeScriptAdapter | undefined;

    // Extract test map if available from rich analysis
    const testMap = (depGraph as any)._testMap as import('./lib/test-mapper.js').TestMap | undefined;

    let summaryCount = 0;
    for (const [, files] of filesToProcess) {
        for (const file of files) {
            const fileSymbols = finalSymbols.filter(s => s.file === file.relativePath);
            const sourceFile = tsAdapter?.getProject()?.getSourceFile(file.filePath);
            const summary = await getOrGenerateSummary(file.relativePath, file.content, fileSymbols, summarizer, summaryCache, sourceFile, richness);

            // Attach rich-level data to summary
            if (richness === 'rich') {
                if (testMap?.sourceToTests[file.relativePath]) {
                    summary.testFiles = testMap.sourceToTests[file.relativePath];
                }
                // Aggregate complexity from symbols
                const complexities = fileSymbols.filter(s => s.complexity != null).map(s => s.complexity!);
                if (complexities.length > 0) {
                    summary.complexityScore = complexities.reduce((a, b) => a + b, 0);
                }
            }

            summaryCount++;
        }
    }

    // Write summary cache atomically
    await atomicWrite(
        path.join(knowledgeRoot, 'summaries', 'cache.json'),
        JSON.stringify(cacheSnapshot, null, 2)
    );
    log(`Summaries: ${summaryCount} processed in ${Date.now() - t3}ms`);

    // ── Phase 4: Index ────────────────────────────────────────────────────────
    const index = await buildIndex(knowledgeRoot);
    (index as any).buildInProgress = false;
    (index as any).buildGeneration = buildGeneration;
    (index as any).richness = richness;
    await writeIndex(knowledgeRoot, index);

    // Cleanup adapters
    for (const adapter of registry.getAllAdapters()) {
        adapter.dispose?.();
    }

    log(`Done in ${Date.now() - t0}ms total`);
}

main().catch(err => {
    process.stderr.write(`[build-knowledge] Fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
});
