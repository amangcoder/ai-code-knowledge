/**
 * Incremental code indexer for the AI Code Knowledge System.
 *
 * Builds .knowledge/symbols.json, .knowledge/dependencies.json,
 * .knowledge/summaries/cache.json, and .knowledge/index.json.
 *
 * Supports incremental mode (re-index changed files + dependents only)
 * and --full mode for complete rebuilds.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.knowledge', '.git', '.next', 'coverage']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file
/** Computes SHA-256 hash of file content for change detection. */
export function computeFileHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}
/** Walk directory collecting source files, skipping excluded dirs and symlinks. */
export function walkSourceFiles(dir, options = {}) {
    const results = [];
    const cap = options.cap ?? 10000;
    function walk(current) {
        if (results.length >= cap)
            return;
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (results.length >= cap)
                break;
            if (EXCLUDED_DIRS.has(entry.name))
                continue;
            if (entry.isSymbolicLink())
                continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (SOURCE_EXTENSIONS.has(ext)) {
                    results.push(fullPath);
                }
            }
        }
    }
    walk(dir);
    return results;
}
/** Load existing summaries cache (for incremental comparison). */
function loadExistingSummaries(knowledgeRoot) {
    const cachePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    try {
        const raw = fs.readFileSync(cachePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
/** Load existing index. */
function loadExistingIndex(knowledgeRoot) {
    const indexPath = path.join(knowledgeRoot, 'index.json');
    try {
        const raw = fs.readFileSync(indexPath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Detect which files have changed since last build using content hash comparison. */
export function detectChangedFiles(sourceFiles, projectRoot, existingSummaries) {
    const changed = new Set();
    for (const absPath of sourceFiles) {
        const relPath = absPath.slice(projectRoot.length + 1).replace(/\\/g, '/');
        const existing = existingSummaries[relPath];
        let content;
        try {
            const stat = fs.statSync(absPath);
            if (stat.size > MAX_FILE_SIZE) {
                changed.add(relPath);
                continue;
            }
            content = fs.readFileSync(absPath, 'utf8');
        }
        catch {
            changed.add(relPath);
            continue;
        }
        const currentHash = computeFileHash(content);
        if (!existing || existing.contentHash !== currentHash) {
            changed.add(relPath);
        }
    }
    return changed;
}
/** Simple TypeScript/JavaScript symbol extractor. */
function extractSymbols(content, relPath, moduleName) {
    const symbols = [];
    const lines = content.split('\n');
    // Patterns for common constructs
    const patterns = [
        // exported async function
        { regex: /^export\s+(async\s+)?function\s+(\w+)\s*(\([^)]*\))?/, type: 'function' },
        // export const arrow function
        { regex: /^export\s+const\s+(\w+)\s*=\s*(async\s+)?\(/, type: 'function' },
        // export class
        { regex: /^export\s+(abstract\s+)?class\s+(\w+)/, type: 'class' },
        // export interface
        { regex: /^export\s+interface\s+(\w+)/, type: 'interface' },
        // export type
        { regex: /^export\s+type\s+(\w+)/, type: 'type' },
        // non-exported function
        { regex: /^(async\s+)?function\s+(\w+)\s*(\([^)]*\))?/, type: 'function' },
        // non-exported class
        { regex: /^class\s+(\w+)/, type: 'class' },
    ];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Collect JSDoc above the declaration
        let jsdoc = '';
        if (i > 0 && lines[i - 1].trim().endsWith('*/')) {
            let j = i - 1;
            while (j >= 0 && !lines[j].trim().startsWith('/**')) {
                j--;
            }
            if (j >= 0) {
                jsdoc = lines.slice(j, i).join('\n');
            }
        }
        for (const { regex, type } of patterns) {
            const match = line.match(regex);
            if (!match)
                continue;
            // Extract name depending on pattern
            let name = '';
            const isExported = line.startsWith('export');
            const isAsync = line.includes('async ');
            if (type === 'function') {
                // Try to get name from various positions
                const funcMatch = line.match(/function\s+(\w+)/) ?? line.match(/const\s+(\w+)/);
                if (funcMatch)
                    name = funcMatch[1];
            }
            else if (type === 'class') {
                const classMatch = line.match(/class\s+(\w+)/);
                if (classMatch)
                    name = classMatch[1];
            }
            else if (type === 'interface') {
                const ifaceMatch = line.match(/interface\s+(\w+)/);
                if (ifaceMatch)
                    name = ifaceMatch[1];
            }
            else if (type === 'type') {
                const typeMatch = line.match(/type\s+(\w+)/);
                if (typeMatch)
                    name = typeMatch[1];
            }
            if (!name)
                continue;
            // Extract return type if present
            const returnTypeMatch = line.match(/\):\s*([^{]+)/);
            const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : undefined;
            // Check for deprecation
            const deprecationNotice = jsdoc.includes('@deprecated')
                ? (jsdoc.match(/@deprecated\s+(.+)$/m)?.[1] ?? 'deprecated')
                : undefined;
            symbols.push({
                name,
                qualifiedName: name,
                file: relPath,
                line: i + 1,
                signature: line.slice(0, 120),
                type,
                module: moduleName,
                calls: [],
                calledBy: [],
                throws: [],
                isExported,
                language: 'typescript',
                jsdoc: jsdoc || undefined,
                returnType,
                isAsync,
                deprecationNotice,
            });
            break; // One match per line
        }
    }
    return symbols;
}
/** Extract imports from a file. */
function extractImports(content, relPath) {
    const imports = [];
    const importRegex = /^import\s+.*?from\s+['"]([^'"]+)['"]/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        // Convert relative imports to resolved paths
        if (importPath.startsWith('.')) {
            const dir = path.dirname(relPath);
            let resolved = path.join(dir, importPath).replace(/\\/g, '/');
            // Try to normalize extension
            if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) {
                resolved += '.ts';
            }
            resolved = resolved.replace(/\.js$/, '.ts');
            imports.push(resolved);
        }
    }
    return imports;
}
/** Detect module name from relative file path. */
function detectModule(relPath) {
    const parts = relPath.split('/');
    return parts.length > 1 ? parts[0] : '(root)';
}
/** Detect cycles in the dependency graph using DFS. */
function detectCycles(edges) {
    const adj = new Map();
    for (const edge of edges) {
        if (!adj.has(edge.from))
            adj.set(edge.from, []);
        adj.get(edge.from).push(edge.to);
    }
    const cycles = [];
    const visited = new Set();
    const inStack = new Set();
    const path_ = [];
    function dfs(node) {
        visited.add(node);
        inStack.add(node);
        path_.push(node);
        for (const neighbor of (adj.get(node) ?? [])) {
            if (!visited.has(neighbor)) {
                dfs(neighbor);
            }
            else if (inStack.has(neighbor)) {
                // Found a cycle
                const cycleStart = path_.indexOf(neighbor);
                if (cycleStart !== -1) {
                    cycles.push([...path_.slice(cycleStart), neighbor]);
                }
            }
        }
        path_.pop();
        inStack.delete(node);
    }
    for (const node of adj.keys()) {
        if (!visited.has(node)) {
            dfs(node);
        }
    }
    return cycles;
}
/** Generate a static (no LLM) file summary. */
function generateStaticSummary(relPath, content, symbols, imports) {
    const filename = relPath.split('/').pop() ?? relPath;
    const exportedSymbols = symbols.filter(s => s.isExported && s.type !== 'module-init');
    // Infer purpose from filename/path
    let purpose = `${filename} module`;
    if (relPath.includes('/lib/')) {
        purpose = `Utility library: ${filename.replace(/\.[tj]sx?$/, '')}`;
    }
    else if (filename === 'server.ts' || filename === 'index.ts') {
        purpose = `Entry point — registers MCP tools and starts the server`;
    }
    else if (filename.startsWith('get-') || filename.startsWith('find-') || filename.startsWith('search-')) {
        const toolName = filename.replace(/\.[tj]sx?$/, '').replace(/-/g, '_');
        purpose = `MCP tool handler for ${toolName}`;
    }
    // Infer architectural role
    let architecturalRole;
    if (filename === 'server.ts' || filename === 'index.ts') {
        architecturalRole = 'entry-point';
    }
    else if (relPath.includes('/lib/')) {
        architecturalRole = 'utility';
    }
    else if (filename.startsWith('get-') || filename.startsWith('find-') || filename.startsWith('search-')) {
        architecturalRole = 'handler';
    }
    // Check for test files association
    const testFiles = [];
    const hash = computeFileHash(content);
    return {
        file: relPath,
        purpose,
        exports: exportedSymbols.map(s => s.name),
        dependencies: imports,
        sideEffects: [],
        throws: [],
        lastUpdated: new Date().toISOString(),
        contentHash: hash,
        architecturalRole,
        testFiles,
        publicAPI: exportedSymbols.slice(0, 10).map(s => ({
            name: s.name,
            type: s.type,
            signature: s.signature,
            jsdoc: s.jsdoc,
        })),
    };
}
/** Main incremental indexer. */
export async function runIndexer(options) {
    const { projectRoot, knowledgeRoot, fullRebuild = false, dryRun = false } = options;
    // Check if build is already in progress
    const indexPath = path.join(knowledgeRoot, 'index.json');
    const existingIndex = loadExistingIndex(knowledgeRoot);
    if (existingIndex?.buildInProgress) {
        process.stderr.write('[indexer] WARNING: Another build is already in progress. Skipping.\n');
        return;
    }
    // Set buildInProgress flag
    if (!dryRun) {
        const inProgressIndex = { ...(existingIndex ?? {}), buildInProgress: true };
        fs.mkdirSync(knowledgeRoot, { recursive: true });
        fs.writeFileSync(indexPath, JSON.stringify(inProgressIndex, null, 2), 'utf8');
    }
    try {
        await runIndexerInternal(options, existingIndex);
    }
    finally {
        // Clear buildInProgress flag on error/completion
        if (!dryRun) {
            try {
                const finalIndex = loadExistingIndex(knowledgeRoot);
                if (finalIndex) {
                    finalIndex.buildInProgress = false;
                    fs.writeFileSync(indexPath, JSON.stringify(finalIndex, null, 2), 'utf8');
                }
            }
            catch {
                // ignore
            }
        }
    }
}
async function runIndexerInternal(options, existingIndex) {
    const { projectRoot, knowledgeRoot, fullRebuild = false, dryRun = false, summarizer = 'static' } = options;
    process.stderr.write(`[indexer] Starting ${fullRebuild ? 'full' : 'incremental'} index of ${projectRoot}\n`);
    const sourceFiles = walkSourceFiles(projectRoot);
    process.stderr.write(`[indexer] Found ${sourceFiles.length} source files\n`);
    const existingSummaries = loadExistingSummaries(knowledgeRoot);
    // Determine which files to re-index
    let filesToIndex;
    if (fullRebuild) {
        filesToIndex = sourceFiles.map(f => f.slice(projectRoot.length + 1).replace(/\\/g, '/'));
    }
    else {
        const changedRelPaths = detectChangedFiles(sourceFiles, projectRoot, existingSummaries);
        filesToIndex = [...changedRelPaths];
        process.stderr.write(`[indexer] ${filesToIndex.length} files changed, re-indexing\n`);
    }
    if (dryRun) {
        process.stderr.write(`[indexer] --dry-run: would index ${filesToIndex.length} files:\n`);
        for (const f of filesToIndex) {
            process.stderr.write(`  - ${f}\n`);
        }
        return;
    }
    // Index each file
    const allSymbols = [];
    const newSummaries = { ...existingSummaries };
    const coverageErrors = { ...(existingIndex?.coverageErrors ?? {}) };
    const richnessMap = { ...(existingIndex?.richnessMap ?? {}) };
    const fileDeps = {};
    for (const relPath of filesToIndex) {
        const absPath = path.join(projectRoot, relPath);
        let content;
        try {
            const stat = fs.statSync(absPath);
            if (stat.size > MAX_FILE_SIZE) {
                coverageErrors[relPath] = `file too large (${stat.size} bytes)`;
                continue;
            }
            content = fs.readFileSync(absPath, 'utf8');
        }
        catch (err) {
            coverageErrors[relPath] = `read error: ${err.message}`;
            continue;
        }
        // Clear any previous error for this file
        delete coverageErrors[relPath];
        try {
            const moduleName = detectModule(relPath);
            const symbols = extractSymbols(content, relPath, moduleName);
            const imports = extractImports(content, relPath);
            // Generate summary
            const summary = generateStaticSummary(relPath, content, symbols, imports);
            // If LLM summarizer requested, try to enhance description
            if (summarizer !== 'static') {
                // LLM enhancement would go here; for now fall back to static
                summary.llmDescription = summary.purpose;
                richnessMap[relPath] = 'rich';
            }
            else {
                richnessMap[relPath] = symbols.length > 0 && summary.architecturalRole ? 'standard' : 'minimal';
            }
            allSymbols.push(...symbols);
            newSummaries[relPath] = summary;
            fileDeps[relPath] = imports;
        }
        catch (err) {
            coverageErrors[relPath] = `parse error: ${err.message}`;
        }
    }
    // Load all symbols for unchanged files (from existing symbols.json)
    const existingSymbolsPath = path.join(knowledgeRoot, 'symbols.json');
    let existingSymbols = [];
    try {
        const raw = fs.readFileSync(existingSymbolsPath, 'utf8');
        existingSymbols = JSON.parse(raw);
    }
    catch {
        // No existing symbols
    }
    // Merge: keep existing symbols for unchanged files, use new for re-indexed
    const reindexedFiles = new Set(filesToIndex);
    const mergedSymbols = [
        ...existingSymbols.filter(s => !reindexedFiles.has(s.file)),
        ...allSymbols,
    ];
    // Build dependency graph
    const allSourceRelPaths = sourceFiles.map(f => f.slice(projectRoot.length + 1).replace(/\\/g, '/'));
    const modules = [...new Set(allSourceRelPaths.map(detectModule))].filter(m => m !== '(root)');
    // Merge fileDeps with existing
    const existingDepsPath = path.join(knowledgeRoot, 'dependencies.json');
    let existingDeps = null;
    try {
        existingDeps = JSON.parse(fs.readFileSync(existingDepsPath, 'utf8'));
    }
    catch {
        // No existing deps
    }
    // Build merged fileDeps
    const mergedFileDeps = { ...(existingDeps?.fileDeps ?? {}) };
    for (const [file, deps] of Object.entries(fileDeps)) {
        mergedFileDeps[file] = deps;
    }
    // Build module-level edges
    const moduleEdgesSet = new Set();
    const moduleEdges = [];
    for (const [fromFile, deps] of Object.entries(mergedFileDeps)) {
        const fromModule = detectModule(fromFile);
        for (const toFile of deps) {
            const toModule = detectModule(toFile);
            if (fromModule !== toModule && fromModule !== '(root)' && toModule !== '(root)') {
                const key = `${fromModule}→${toModule}`;
                if (!moduleEdgesSet.has(key)) {
                    moduleEdgesSet.add(key);
                    moduleEdges.push({ from: fromModule, to: toModule, type: 'direct' });
                }
            }
        }
    }
    const cycles = detectCycles(moduleEdges);
    const dependencyGraph = {
        nodes: modules,
        edges: moduleEdges,
        cycles,
        fileDeps: mergedFileDeps,
    };
    // Compute symbol counts
    const symbolCounts = {};
    for (const sym of mergedSymbols) {
        symbolCounts[sym.type] = (symbolCounts[sym.type] ?? 0) + 1;
    }
    // Build index
    const generation = (existingIndex?.buildGeneration ?? 0) + 1;
    const newIndex = {
        modules,
        summaries: Object.keys(newSummaries),
        hasSymbols: mergedSymbols.length > 0,
        hasDependencies: moduleEdges.length > 0,
        lastBuilt: new Date().toISOString(),
        fileCount: Object.keys(newSummaries).length,
        buildInProgress: true, // Will be cleared by runIndexer()
        buildGeneration: generation,
        symbolCounts,
        richness: summarizer !== 'static' ? 'rich' : 'standard',
        richnessMap,
        coverageErrors: Object.keys(coverageErrors).length > 0 ? coverageErrors : undefined,
    };
    // Write to temp directory, then atomic rename
    const tempRoot = knowledgeRoot + '.new';
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'summaries'), { recursive: true });
    // Write all files
    fs.writeFileSync(path.join(tempRoot, 'index.json'), JSON.stringify(newIndex, null, 2), 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'symbols.json'), JSON.stringify(mergedSymbols, null, 2), 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'dependencies.json'), JSON.stringify(dependencyGraph, null, 2), 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'summaries', 'cache.json'), JSON.stringify(newSummaries, null, 2), 'utf8');
    // Copy architecture.md if it exists
    const archSrc = path.join(knowledgeRoot, 'architecture.md');
    const archDst = path.join(tempRoot, 'architecture.md');
    try {
        fs.copyFileSync(archSrc, archDst);
    }
    catch {
        // architecture.md is optional
    }
    // Atomic rename: move tempRoot to knowledgeRoot
    // We copy each file individually since rename across mount points can fail
    for (const file of fs.readdirSync(tempRoot)) {
        const srcFile = path.join(tempRoot, file);
        const dstFile = path.join(knowledgeRoot, file);
        if (fs.statSync(srcFile).isDirectory()) {
            fs.mkdirSync(dstFile, { recursive: true });
            for (const subFile of fs.readdirSync(srcFile)) {
                fs.copyFileSync(path.join(srcFile, subFile), path.join(dstFile, subFile));
            }
        }
        else {
            fs.copyFileSync(srcFile, dstFile);
        }
    }
    // Cleanup temp directory
    try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    catch {
        // ignore cleanup errors
    }
    process.stderr.write(`[indexer] Build #${generation} complete: ${Object.keys(newSummaries).length} files, ` +
        `${mergedSymbols.length} symbols, ${Object.keys(coverageErrors).length} errors\n`);
}
