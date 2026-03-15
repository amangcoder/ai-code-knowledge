# Machine-Executable Development Plan: AI Code Knowledge System

## Context

This plan builds the improved architecture described in `ARCHITECTURE_EVALUATION.md` (authoritative design guidance), **not** the basic PRD. The evaluation identifies three blocking problems with the PRD design (no meaningful Purpose fields without LLM, pre-commit-only updates = stale knowledge, text-search tools duplicate native grep) and specifies the corrected architecture.

**Target outcome:** A TypeScript-based system that extracts structured knowledge (symbol graph + dependency graph + LLM-assisted summaries) from a codebase, stores it in `.knowledge/`, and exposes it via a local MCP server to Claude Code. Primary value is reducing exploration token overhead for repos 500+ files.

**Execution model:** Each task is designed for a weak coding agent (Gemini Flash). Tasks are isolated, deterministic, and ≤ 200 LOC. A stronger model (Claude Sonnet) reviews output.

---

## Critical Files

| File | Role |
|---|---|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config for entire project |
| `src/types.ts` | Shared interfaces for all components |
| `scripts/build-knowledge.ts` | Orchestrator entry point |
| `scripts/lib/symbol-extractor.ts` | ts-morph AST extraction |
| `scripts/lib/call-graph.ts` | Call graph builder + inverter |
| `scripts/lib/dependency-extractor.ts` | Import graph per file |
| `scripts/lib/dependency-graph.ts` | Module-level graph builder |
| `scripts/lib/summarizer.ts` | Summarizer interface |
| `scripts/lib/summarizer-factory.ts` | Factory: static/ollama/anthropic |
| `scripts/lib/summary-cache.ts` | Hash-based cache manager |
| `mcp-server/server.ts` | MCP server entry point |
| `mcp-server/tools/find-symbol.ts` | find_symbol tool |
| `mcp-server/tools/find-callers.ts` | find_callers tool |
| `mcp-server/tools/get-dependencies.ts` | get_dependencies tool |
| `mcp-server/tools/get-file-summary.ts` | get_file_summary tool |
| `mcp-server/tools/search-architecture.ts` | search_architecture tool |
| `scripts/watch.ts` | chokidar file watcher |
| `.claude/mcp_servers.json` | Claude Code MCP registration |
| `CLAUDE.md` | Agent instructions |

---

## Shared TypeScript Types (reference for all tasks)

All tasks reference these types. They live in `src/types.ts`.

```typescript
interface SymbolEntry {
  name: string
  qualifiedName: string        // "OrderService.createOrder"
  file: string                 // absolute path
  line: number
  signature: string
  type: 'function' | 'class' | 'interface' | 'type' | 'method'
  module: string               // parent directory name
  calls: string[]              // qualifiedNames of called symbols
  calledBy: string[]           // qualifiedNames of callers (inverted index)
  throws: string[]
  isExported: boolean
}

interface DependencyGraph {
  nodes: string[]
  edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }>
  cycles: string[][]
  fileDeps: Record<string, string[]>  // file -> imported file paths
}

interface FileSummary {
  file: string
  purpose: string
  exports: string[]
  dependencies: string[]
  sideEffects: string[]
  throws: string[]
  lastUpdated: string
  contentHash: string
}

interface KnowledgeIndex {
  modules: string[]
  summaries: string[]
  hasSymbols: boolean
  hasDependencies: boolean
  lastBuilt: string
  fileCount: number
}
```

---

## PHASE 1 — PROJECT BOOTSTRAP

### Task 1.1 — Create package.json

**Objective:** Initialize the Node.js project with all required dependencies and npm scripts.

**Files:** `package.json`

**Implementation Steps:**
1. Create `package.json` with `name: "ai-code-knowledge"`, `version: "0.1.0"`, `type: "module"`
2. Add `dependencies`: `@modelcontextprotocol/sdk@^1.0.0`, `ts-morph@^23.0.0`, `chokidar@^3.6.0`, `zod@^3.23.0`
3. Add `devDependencies`: `typescript@^5.7.0`, `tsx@^4.19.0`, `@types/node@^22.0.0`, `vitest@^2.0.0`
4. Add `scripts`:
   - `"build-knowledge": "tsx scripts/build-knowledge.ts"`
   - `"build-knowledge:incremental": "tsx scripts/build-knowledge.ts --incremental"`
   - `"watch": "tsx scripts/watch.ts"`
   - `"build-mcp": "tsc --project tsconfig.mcp.json"`
   - `"start-mcp": "node mcp-server/server.js"`
   - `"test": "vitest run"`
   - `"install-hooks": "sh scripts/install-hooks.sh"`

**Expected Output:** `package.json` file at project root.

**Acceptance Criteria:**
- File is valid JSON
- All listed packages are present under correct sections
- All listed scripts are present

---

### Task 1.2 — Create TypeScript configs

**Objective:** Create two TypeScript configs — one for scripts (tsx runtime), one for MCP server (compiled to CJS for Node).

**Files:** `tsconfig.json`, `tsconfig.mcp.json`

**Implementation Steps:**
1. Create `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "strict": true,
       "esModuleInterop": true,
       "outDir": "dist",
       "rootDir": ".",
       "skipLibCheck": true
     },
     "include": ["src/**/*", "scripts/**/*", "mcp-server/**/*"]
   }
   ```
2. Create `tsconfig.mcp.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "module": "CommonJS",
       "moduleResolution": "Node",
       "outDir": "mcp-server/dist"
     },
     "include": ["mcp-server/**/*", "src/types.ts"]
   }
   ```

**Expected Output:** Two `.json` files at project root.

**Acceptance Criteria:**
- Both files are valid JSON
- `npx tsc --noEmit` passes after types are created in Task 1.3

---

### Task 1.3 — Create shared types file

**Objective:** Define all shared TypeScript interfaces used across scripts and MCP server.

**Files:** `src/types.ts`

**Implementation Steps:**
1. Create `src/` directory
2. Create `src/types.ts` exporting all four interfaces from the "Shared TypeScript Types" section above: `SymbolEntry`, `DependencyGraph`, `FileSummary`, `KnowledgeIndex`
3. Also export: `interface CallSite { caller: string; file: string; line: number; callChain: string[] }`
4. Also export: `type SummarizerMode = 'static' | 'ollama' | 'anthropic'`

**Expected Output:** `src/types.ts` with 5 exported interfaces and 1 type alias.

**Acceptance Criteria:**
- File compiles with `npx tsc --noEmit`
- All 5 interfaces and 1 type are exported

---

### Task 1.4 — Create .knowledge directory scaffold

**Objective:** Create the knowledge directory structure with initial empty files.

**Files:** `.knowledge/architecture.md`, `.knowledge/index.json`, `.knowledge/summaries/.gitkeep`, `.knowledge/symbols.json`, `.knowledge/dependencies.json`

**Implementation Steps:**
1. Create `.knowledge/` directory
2. Create `.knowledge/architecture.md` with template header:
   ```markdown
   # Architecture Overview

   > This file is human-authored. Update it to reflect your system's architecture.

   ## Modules

   ## Key Workflows
   ```
3. Create `.knowledge/index.json` with empty index:
   ```json
   { "modules": [], "summaries": [], "hasSymbols": false, "hasDependencies": false, "lastBuilt": "", "fileCount": 0 }
   ```
4. Create `.knowledge/summaries/` directory with `.gitkeep`
5. Create empty `.knowledge/symbols.json` with `[]`
6. Create empty `.knowledge/dependencies.json` with `{ "nodes": [], "edges": [], "cycles": [], "fileDeps": {} }`

**Expected Output:** `.knowledge/` tree with 5 files.

**Acceptance Criteria:**
- All listed files exist
- JSON files parse without errors

---

### Task 1.5 — Create CLAUDE.md

**Objective:** Write agent instructions that guide Claude Code to use MCP tools before scanning files.

**Files:** `CLAUDE.md`

**Implementation Steps:**
Create `CLAUDE.md` with these sections:
1. **Overview**: What this repo is and what `.knowledge/` contains
2. **MCP Tools Available**: List all 5 tools with one-line descriptions
3. **Preferred Tool Order**: Numbered list — `find_symbol` → `find_callers` → `get_dependencies` → `get_file_summary` → `search_architecture` → native grep (last resort)
4. **When to Use Each Tool**: One paragraph per tool explaining its purpose and example queries
5. **DO NOT**: List of behaviors to avoid (reading full files before querying MCP, skipping MCP when unsure)
6. **Knowledge Freshness**: Note that watcher must be running for live updates; fallback to `npm run build-knowledge` if stale

**Expected Output:** `CLAUDE.md` with ≥ 6 sections.

**Acceptance Criteria:**
- Document is readable and actionable
- All 5 tool names are mentioned
- Preferred tool order is clearly numbered

---

### Task 1.6 — Create git hook installer

**Objective:** Shell script that installs a pre-commit hook to regenerate knowledge on commit.

**Files:** `scripts/install-hooks.sh`

**Implementation Steps:**
1. Create `scripts/install-hooks.sh`:
   ```bash
   #!/bin/sh
   HOOK=".git/hooks/pre-commit"
   echo '#!/bin/sh\nnpm run build-knowledge\ngit add .knowledge/' > $HOOK
   chmod +x $HOOK
   echo "Pre-commit hook installed at $HOOK"
   ```

**Expected Output:** `scripts/install-hooks.sh`

**Acceptance Criteria:**
- Script is executable (`chmod +x`)
- Running it creates `.git/hooks/pre-commit`
- Pre-commit hook runs `npm run build-knowledge` and stages `.knowledge/`

---

## PHASE 2 — SYMBOL GRAPH INDEXER

### Task 2.1 — Create symbol extractor utility

**Objective:** Extract function/class/interface/type symbols from a single TypeScript source file using ts-morph.

**Files:** `scripts/lib/symbol-extractor.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Import `Project, SourceFile, SyntaxKind` from `ts-morph`
2. Import `SymbolEntry` from `../../src/types.ts`
3. Export function `extractSymbols(sourceFile: SourceFile, projectRoot: string): SymbolEntry[]`
4. For **functions**: iterate `sourceFile.getFunctions()`, capture name, line, signature (params + return type), isExported. Set `calls: [], calledBy: [], throws: []`.
5. For **classes**: iterate `sourceFile.getClasses()`. For each class, emit one `SymbolEntry` for the class itself. For each method, emit one entry with `qualifiedName = "ClassName.methodName"`.
6. For **interfaces**: iterate `sourceFile.getInterfaces()`, emit one entry per interface.
7. For **type aliases**: iterate `sourceFile.getTypeAliases()`.
8. Set `module` = parent directory name of the file (last segment of `path.dirname(file)`)
9. Set `file` = path relative to `projectRoot`

**Expected Output:** `scripts/lib/symbol-extractor.ts` (~80 LOC)

**Acceptance Criteria:**
- Calling `extractSymbols(sf, root)` on a file with 2 exported functions returns an array of 2 entries
- Each entry has non-empty `name`, `file`, `line`, `signature`
- `calls` and `calledBy` are empty arrays (populated in Task 2.2)

---

### Task 2.2 — Build call graph linker

**Objective:** For each extracted symbol, find which other project symbols it calls.

**Files:** `scripts/lib/call-graph.ts`

**Context files needed:** `src/types.ts`, `scripts/lib/symbol-extractor.ts`

**Implementation Steps:**
1. Import `Project, Node, SyntaxKind` from `ts-morph`
2. Import `SymbolEntry` from `../../src/types.ts`
3. Export function `buildCallGraph(project: Project, symbols: SymbolEntry[]): SymbolEntry[]`
4. Build a lookup map: `qualifiedName → SymbolEntry`
5. For each source file in the project:
   a. Get all `CallExpression` nodes using `sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)`
   b. For each call expression, resolve the called symbol using `callExpr.getExpression().getSymbol()?.getDeclarations()`
   c. If the resolved symbol is in the lookup map, add its qualifiedName to the caller's `calls` array
6. Return modified symbols array (do not mutate input)

**Expected Output:** `scripts/lib/call-graph.ts` (~70 LOC)

**Acceptance Criteria:**
- For a sample file where `functionA` calls `functionB`, `functionA.calls` contains `functionB`'s qualifiedName after running this function
- External library calls (e.g., `console.log`) are ignored (not in lookup map)

---

### Task 2.3 — Build calledBy inverter

**Objective:** Add `calledBy` arrays by inverting the `calls` graph.

**Files:** `scripts/lib/call-graph.ts` (extend existing file)

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Export additional function `invertCallGraph(symbols: SymbolEntry[]): SymbolEntry[]`
2. Build a map: for each symbol, for each entry in `calls`, add the calling symbol's qualifiedName to the callee's `calledBy`
3. Return new symbols array with `calledBy` populated

**Expected Output:** Updated `scripts/lib/call-graph.ts` with second exported function

**Acceptance Criteria:**
- If `A.calls = ["B"]`, after inversion `B.calledBy` includes `"A"`
- Original `symbols` array is not mutated

---

### Task 2.4 — Create build-symbols.ts script

**Objective:** Orchestrator that runs symbol extraction + call graph building for the entire project and writes `symbols.json`.

**Files:** `scripts/build-symbols.ts`

**Context files needed:** `scripts/lib/symbol-extractor.ts`, `scripts/lib/call-graph.ts`, `src/types.ts`

**Implementation Steps:**
1. Accept CLI arg `--root <path>` (default: current working directory)
2. Create ts-morph `Project` from `tsconfig.json` at root (or add files from `src/**/*.ts` if no tsconfig)
3. For each source file, call `extractSymbols(sourceFile, root)` → accumulate into flat array
4. Call `buildCallGraph(project, allSymbols)` → call graph populated
5. Call `invertCallGraph(symbols)` → calledBy populated
6. Write result to `.knowledge/symbols.json` using `JSON.stringify(symbols, null, 2)`
7. Log: `"Extracted N symbols from M files"`

**Expected Output:** `scripts/build-symbols.ts` (~60 LOC)

**Acceptance Criteria:**
- Running `npx tsx scripts/build-symbols.ts` creates `.knowledge/symbols.json`
- JSON is valid and contains array of SymbolEntry objects
- Completes in < 5 seconds on a 100-file project

---

## PHASE 3 — DEPENDENCY GRAPH GENERATION

### Task 3.1 — Create file-level dependency extractor

**Objective:** Extract all imports from a TypeScript file and resolve them to absolute paths.

**Files:** `scripts/lib/dependency-extractor.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Import `SourceFile` from `ts-morph`, `path` and `fs` from Node
2. Export function `extractFileDeps(sourceFile: SourceFile, projectRoot: string): string[]`
3. Get all import declarations: `sourceFile.getImportDeclarations()`
4. For each import, get `moduleSpecifier` string value
5. Skip non-relative imports (those not starting with `.` or `/`) — these are npm packages
6. Resolve relative imports to absolute paths using `path.resolve(path.dirname(sourceFile.getFilePath()), specifier)`
7. Add `.ts` extension if missing and file exists; also check `.tsx`
8. Return array of absolute paths (deduplicated)
9. Also get dynamic imports: `sourceFile.getDescendantsOfKind(SyntaxKind.ImportExpression)` — for string literal args, resolve same way. For non-string args, skip.

**Expected Output:** `scripts/lib/dependency-extractor.ts` (~60 LOC)

**Acceptance Criteria:**
- For a file importing `./order.service`, returns resolved absolute path to `order.service.ts`
- npm package imports (`import express from 'express'`) are excluded from output
- Dynamic imports with string literals are included

---

### Task 3.2 — Build module grouper

**Objective:** Group files by their parent module directory.

**Files:** `scripts/lib/module-grouper.ts`

**Implementation Steps:**
1. Export function `groupFilesByModule(filePaths: string[], projectRoot: string): Record<string, string[]>`
2. For each file path, compute relative path from projectRoot
3. The module name = the second path segment (e.g., `src/orders/order.service.ts` → `"orders"`)
4. If file is directly in `src/`, module name = filename without extension
5. Return Record mapping module name to array of relative file paths

**Expected Output:** `scripts/lib/module-grouper.ts` (~30 LOC)

**Acceptance Criteria:**
- `src/orders/order.service.ts` and `src/orders/order.controller.ts` both map to `"orders"`
- `src/index.ts` maps to `"index"`

---

### Task 3.3 — Create dependency graph builder

**Objective:** Build module-level dependency graph with cycle detection.

**Files:** `scripts/lib/dependency-graph.ts`

**Context files needed:** `src/types.ts`, `scripts/lib/module-grouper.ts`

**Implementation Steps:**
1. Import `DependencyGraph` from types; import `groupFilesByModule`
2. Export function `buildDependencyGraph(fileDeps: Record<string, string[]>, projectRoot: string): DependencyGraph`
   - `fileDeps` is a map from absolute file path → array of absolute dependency file paths
3. Call `groupFilesByModule` to get module map
4. Build module-level edges: if file in module A imports file in module B, add edge `A → B` (deduplicate)
5. Detect cycles using DFS: implement `findCycles(nodes, edges): string[][]`
6. Return `DependencyGraph` with `nodes`, `edges`, `cycles`, `fileDeps` (paths made relative to projectRoot)

**Expected Output:** `scripts/lib/dependency-graph.ts` (~90 LOC)

**Acceptance Criteria:**
- Circular import between two modules appears in `cycles` array
- Each edge appears only once (deduplication works)
- `fileDeps` contains relative paths, not absolute

---

### Task 3.4 — Create build-dependencies.ts script

**Objective:** Orchestrate dependency graph extraction and write `dependencies.json`.

**Files:** `scripts/build-dependencies.ts`

**Context files needed:** `scripts/lib/dependency-extractor.ts`, `scripts/lib/dependency-graph.ts`

**Implementation Steps:**
1. Accept CLI arg `--root <path>` (default: cwd)
2. Create ts-morph Project, load all source files from `src/**/*.ts`
3. For each source file, call `extractFileDeps(sf, root)` → build `fileDeps` map
4. Call `buildDependencyGraph(fileDeps, root)`
5. Write result to `.knowledge/dependencies.json`
6. Log: `"Mapped dependencies for N files. Found M cycles."`

**Expected Output:** `scripts/build-dependencies.ts` (~50 LOC)

**Acceptance Criteria:**
- Running `npx tsx scripts/build-dependencies.ts` creates `.knowledge/dependencies.json`
- JSON is valid and matches `DependencyGraph` interface
- Cycles correctly reported

---

## PHASE 4 — LLM SUMMARY INDEXING

### Task 4.1 — Define Summarizer interface

**Objective:** Create the abstraction layer for LLM summarization.

**Files:** `scripts/lib/summarizer.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Export interface:
   ```typescript
   export interface Summarizer {
     summarizeFile(
       filePath: string,
       content: string,
       symbols: SymbolEntry[]
     ): Promise<FileSummary>
   }
   ```
2. Export helper function `buildPrompt(filePath: string, content: string, symbols: SymbolEntry[]): string` that returns a structured prompt asking the LLM to output JSON with fields: `purpose`, `exports`, `dependencies`, `sideEffects`, `throws`
3. Export function `parseResponse(raw: string): Partial<FileSummary>` that extracts JSON from LLM response (handles markdown code fences)

**Expected Output:** `scripts/lib/summarizer.ts` (~50 LOC)

**Acceptance Criteria:**
- Interface and both helpers are exported
- `parseResponse` correctly extracts JSON from a response wrapped in ```json ... ```
- `parseResponse` returns empty object (not throws) on invalid JSON

---

### Task 4.2 — Implement static summarizer

**Objective:** No-LLM summarizer that builds FileSummary from AST data alone.

**Files:** `scripts/lib/summarizers/static-summarizer.ts`

**Context files needed:** `src/types.ts`, `scripts/lib/summarizer.ts`

**Implementation Steps:**
1. Create class `StaticSummarizer implements Summarizer`
2. `summarizeFile` implementation:
   a. `purpose` = `"${path.basename(filePath, ext)} module"` (file-name-derived, clearly non-LLM)
   b. `exports` = symbols filter where `isExported === true`, map to `name`
   c. `dependencies` = extracted from import statements using a simple regex: `/^import .+ from ['"]([^'"]+)['"]/gm`
   d. `sideEffects` = `[]` (cannot determine without LLM)
   e. `throws` = symbols flatMap `s.throws`
   f. `contentHash` = SHA-256 of content (use Node `crypto.createHash('sha256')`)
   g. `lastUpdated` = new Date().toISOString()
3. Export a singleton: `export const staticSummarizer = new StaticSummarizer()`

**Expected Output:** `scripts/lib/summarizers/static-summarizer.ts` (~50 LOC)

**Acceptance Criteria:**
- Returns valid `FileSummary` for any TypeScript file
- `exports` matches the exported symbol names from the symbols array
- `contentHash` is a 64-character hex string

---

### Task 4.3 — Implement Ollama summarizer

**Objective:** LLM summarizer using Ollama HTTP API.

**Files:** `scripts/lib/summarizers/ollama-summarizer.ts`

**Context files needed:** `scripts/lib/summarizer.ts`, `src/types.ts`

**Implementation Steps:**
1. Create class `OllamaSummarizer implements Summarizer`
2. Constructor: `constructor(private baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434', private model = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b')`
3. `summarizeFile` implementation:
   a. Build prompt with `buildPrompt(filePath, content, symbols)`
   b. POST to `${baseUrl}/api/generate` with body `{ model, prompt, stream: false }`
   c. Parse `response.response` field as JSON using `parseResponse`
   d. Fill missing fields with static fallbacks
   e. Add `contentHash`, `lastUpdated`, `file`
   f. On HTTP error or timeout (10s), throw `Error('Ollama unreachable: ...')` with the URL

**Expected Output:** `scripts/lib/summarizers/ollama-summarizer.ts` (~60 LOC)

**Acceptance Criteria:**
- Returns valid `FileSummary` when Ollama is running with the model loaded
- Throws descriptive error with URL when Ollama is not running
- Timeout is 10 seconds

---

### Task 4.4 — Implement Anthropic summarizer

**Objective:** LLM summarizer using Anthropic SDK (claude-haiku-4-5 for cost efficiency).

**Files:** `scripts/lib/summarizers/anthropic-summarizer.ts`

**Context files needed:** `scripts/lib/summarizer.ts`, `src/types.ts`

**Implementation Steps:**
1. Add `@anthropic-ai/sdk` to `package.json` dependencies
2. Create class `AnthropicSummarizer implements Summarizer`
3. Constructor: `constructor(private model = 'claude-haiku-4-5-20251001')`
4. `summarizeFile` implementation:
   a. Check `ANTHROPIC_API_KEY` env var; throw `Error('ANTHROPIC_API_KEY not set')` if missing
   b. Initialize `Anthropic()` client
   c. Build prompt with `buildPrompt(filePath, content, symbols)`
   d. Call `client.messages.create({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })`
   e. Extract text from response, parse with `parseResponse`
   f. Fill missing fields with static fallbacks, add `contentHash`, `lastUpdated`, `file`

**Expected Output:** `scripts/lib/summarizers/anthropic-summarizer.ts` (~55 LOC)

**Acceptance Criteria:**
- Returns valid `FileSummary` when `ANTHROPIC_API_KEY` is set
- Throws `'ANTHROPIC_API_KEY not set'` when env var missing
- Uses model `claude-haiku-4-5-20251001`

---

### Task 4.5 — Create summarizer factory

**Objective:** Return correct Summarizer based on `SUMMARIZER_MODE` env var.

**Files:** `scripts/lib/summarizer-factory.ts`

**Context files needed:** `scripts/lib/summarizer.ts`, `scripts/lib/summarizers/`

**Implementation Steps:**
1. Import all three summarizers
2. Export function `createSummarizer(): Summarizer`:
   - Read `SUMMARIZER_MODE` env var (default: `'static'`)
   - `'static'` → return `staticSummarizer`
   - `'ollama'` → return `new OllamaSummarizer()`
   - `'anthropic'` → return `new AnthropicSummarizer()`
   - unknown value → log warning, return `staticSummarizer`

**Expected Output:** `scripts/lib/summarizer-factory.ts` (~25 LOC)

**Acceptance Criteria:**
- `SUMMARIZER_MODE=ollama` returns OllamaSummarizer instance
- `SUMMARIZER_MODE=anthropic` returns AnthropicSummarizer instance
- Unset or `SUMMARIZER_MODE=static` returns staticSummarizer
- Unknown value logs a warning and returns staticSummarizer

---

### Task 4.6 — Create summary cache manager

**Objective:** Skip LLM calls for files whose content hasn't changed since last run.

**Files:** `scripts/lib/summary-cache.ts`

**Context files needed:** `src/types.ts`, `scripts/lib/summarizer.ts`

**Implementation Steps:**
1. Cache file location: `.knowledge/summaries/cache.json` — structure: `Record<string, FileSummary>`  (key = relative file path)
2. Export class `SummaryCache`:
   - `load()`: reads cache.json, returns Record or `{}`
   - `get(filePath, contentHash)`: returns cached `FileSummary` if `cache[filePath]?.contentHash === contentHash`, else undefined
   - `set(filePath, summary)`: updates in-memory cache
   - `save()`: writes cache to `.knowledge/summaries/cache.json`
3. Export function `getOrGenerateSummary(filePath, content, symbols, summarizer, cache): Promise<FileSummary>`:
   - Compute SHA-256 of `content`
   - Check `cache.get(filePath, hash)` — return cached if hit
   - Otherwise call `summarizer.summarizeFile(filePath, content, symbols)`
   - Call `cache.set(filePath, result)`
   - Return result

**Expected Output:** `scripts/lib/summary-cache.ts` (~70 LOC)

**Acceptance Criteria:**
- Second call with same file content and hash returns cached result without calling summarizer (verified by mock)
- Changed content (different hash) triggers summarizer call
- `save()` writes valid JSON to `.knowledge/summaries/cache.json`

---

## PHASE 5 — KNOWLEDGE STORAGE

### Task 5.1 — Create atomic file writer utility

**Objective:** Prevent partial reads by MCP server during knowledge writes.

**Files:** `scripts/lib/atomic-writer.ts`

**Implementation Steps:**
1. Export async function `atomicWrite(filePath: string, content: string): Promise<void>`
2. Write to `filePath + '.tmp'`
3. Use `fs.promises.rename(tmpPath, filePath)` to atomically replace
4. Create parent directories if they don't exist (`fs.promises.mkdir(..., { recursive: true })`)

**Expected Output:** `scripts/lib/atomic-writer.ts` (~25 LOC)

**Acceptance Criteria:**
- File is written atomically (no `.tmp` files left on completion)
- Parent directories created automatically
- On write error, original file is not corrupted

---

### Task 5.2 — Create index builder

**Objective:** Generate the master `.knowledge/index.json`.

**Files:** `scripts/lib/index-builder.ts`

**Context files needed:** `src/types.ts`, `scripts/lib/atomic-writer.ts`

**Implementation Steps:**
1. Export async function `buildIndex(opts: { root: string; modules: string[]; summaryFiles: string[]; hasSymbols: boolean; hasDependencies: boolean; fileCount: number }): Promise<void>`
2. Build `KnowledgeIndex` object from opts
3. Set `lastBuilt = new Date().toISOString()`
4. Write to `.knowledge/index.json` using `atomicWrite`

**Expected Output:** `scripts/lib/index-builder.ts` (~30 LOC)

**Acceptance Criteria:**
- Resulting `index.json` parses as valid `KnowledgeIndex`
- `lastBuilt` is a valid ISO timestamp
- Existing `index.json` is replaced atomically

---

### Task 5.3 — Create build-knowledge.ts orchestrator

**Objective:** Single entry point that runs all extraction steps in sequence.

**Files:** `scripts/build-knowledge.ts`

**Context files needed:** All `scripts/lib/` files, `src/types.ts`

**Implementation Steps:**
1. Parse CLI args: `--incremental` flag, `--files <glob>` for targeted rebuild, `--root <path>` (default: cwd)
2. If NOT incremental: run full pipeline:
   a. `build-symbols.ts` logic (inline or import)
   b. `build-dependencies.ts` logic (inline or import)
   c. For each source file, generate/cache summary using `getOrGenerateSummary`
   d. Write all summaries to `.knowledge/summaries/<relative-path>.json`
   e. Call `buildIndex`
3. If incremental: accept file list, only process those files
4. Log total time and file count at end

**Expected Output:** `scripts/build-knowledge.ts` (~120 LOC)

**Acceptance Criteria:**
- Running `npm run build-knowledge` produces all four knowledge artifacts: `symbols.json`, `dependencies.json`, `summaries/`, `index.json`
- Completes in < 10 seconds for 500 files in static mode
- `--incremental` flag only writes changed files

---

## PHASE 6 — MCP SERVER

### Task 6.1 — Create MCP server entry point

**Objective:** Initialize MCP server and register all tools.

**Files:** `mcp-server/server.ts`

**Context files needed:** `@modelcontextprotocol/sdk` docs

**Implementation Steps:**
1. Import `Server` from `@modelcontextprotocol/sdk/server/index.js`
2. Import `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
3. Import all 5 tool handlers from `./tools/`
4. Create server: `new Server({ name: 'repo-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } })`
5. Register `ListToolsRequestSchema` handler returning all 5 tool definitions (name, description, inputSchema using Zod-to-JSON)
6. Register `CallToolRequestSchema` handler routing to correct tool by name
7. Connect with `StdioServerTransport`
8. Add error handling: log errors to stderr, not stdout (MCP uses stdout for protocol)

**Expected Output:** `mcp-server/server.ts` (~80 LOC)

**Acceptance Criteria:**
- `npx tsx mcp-server/server.ts` starts without errors
- Server responds to `tools/list` request
- All 5 tools appear in the tool list

---

### Task 6.2 — Implement find_symbol tool

**Objective:** Symbol lookup by name from symbols.json.

**Files:** `mcp-server/tools/find-symbol.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Define input schema: `{ name: string, type?: 'function' | 'class' | 'interface' | 'type' }`
2. Load `.knowledge/symbols.json` (relative to cwd where server runs)
3. Filter: `symbol.name.toLowerCase().includes(name.toLowerCase())`
4. If `type` provided, additionally filter by `symbol.type === type`
5. Limit results to 20 (sort by name length ascending — most precise matches first)
6. Return array as JSON string in tool result
7. If symbols.json missing, return error message: `"symbols.json not found. Run npm run build-knowledge first."`

**Expected Output:** `mcp-server/tools/find-symbol.ts` (~50 LOC)

**Acceptance Criteria:**
- Returns matching symbols for a query that exists in the index
- Returns empty array for queries with no match
- Returns error string if symbols.json doesn't exist

---

### Task 6.3 — Implement find_callers tool

**Objective:** Return all symbols that call a given symbol.

**Files:** `mcp-server/tools/find-callers.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Define input schema: `{ symbol: string, maxDepth?: number }` (maxDepth default: 1)
2. Load `.knowledge/symbols.json`
3. Find the target symbol by qualifiedName or name match
4. If `maxDepth === 1`: return all symbols in `symbol.calledBy` with their file/line info
5. If `maxDepth > 1`: do BFS traversal up the call chain up to maxDepth levels
6. Return `CallSite[]` as JSON
7. If target symbol not found, return: `"Symbol not found: <name>"`

**Expected Output:** `mcp-server/tools/find-callers.ts` (~60 LOC)

**Acceptance Criteria:**
- For a symbol with known callers, returns correct callers
- `maxDepth=2` returns second-level callers
- Returns clear message when symbol not found

---

### Task 6.4 — Implement get_dependencies tool

**Objective:** Return dependency graph for a module.

**Files:** `mcp-server/tools/get-dependencies.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Define input schema: `{ module: string, depth?: number }` (depth default: 1)
2. Load `.knowledge/dependencies.json`
3. Find direct dependencies: edges where `edge.from === module`
4. If `depth > 1`: BFS traversal to collect transitive deps up to depth levels
5. Return: `{ direct: string[], transitive: string[], graph: Edge[] }` as JSON
6. If module not found, return list of available modules

**Expected Output:** `mcp-server/tools/get-dependencies.ts` (~55 LOC)

**Acceptance Criteria:**
- Returns correct direct dependencies for a known module
- `depth=2` includes second-level dependencies in `transitive`
- Returns list of modules when requested module not found

---

### Task 6.5 — Implement get_file_summary tool

**Objective:** Return summary for a specific file.

**Files:** `mcp-server/tools/get-file-summary.ts`

**Context files needed:** `src/types.ts`

**Implementation Steps:**
1. Define input schema: `{ file: string }`
2. Normalize input: strip leading `./` or `/`, ensure `.ts` extension
3. Load `.knowledge/summaries/cache.json`
4. Look up summary by relative file path (try exact match, then partial match)
5. Return `FileSummary` as formatted JSON string
6. If not found: return `"No summary found for <file>. Available summaries: [list first 10]"`

**Expected Output:** `mcp-server/tools/get-file-summary.ts` (~45 LOC)

**Acceptance Criteria:**
- Returns correct summary for a file that has been indexed
- Returns helpful error with available files when not found
- Works with both `src/orders/order.service.ts` and `order.service.ts` inputs

---

### Task 6.6 — Implement search_architecture tool

**Objective:** Search architecture.md and module docs for a query term.

**Files:** `mcp-server/tools/search-architecture.ts`

**Implementation Steps:**
1. Define input schema: `{ query: string }`
2. Read `.knowledge/architecture.md`
3. Split into lines; find lines matching query (case-insensitive)
4. For each match, include ±3 lines context (deduplicated, not overlapping)
5. Format each excerpt as `"[architecture.md:42]\n<lines>"`
6. Join all excerpts with `\n---\n`
7. Return as string; if no matches, return `"No results for: <query>"`

**Expected Output:** `mcp-server/tools/search-architecture.ts` (~50 LOC)

**Acceptance Criteria:**
- Returns relevant excerpts for a query that appears in architecture.md
- Context lines are included (±3)
- Empty result message is clear

---

### Task 6.7 — Add health_check tool

**Objective:** Tool that returns knowledge index metadata for observability.

**Files:** `mcp-server/server.ts` (extend) or `mcp-server/tools/health-check.ts`

**Implementation Steps:**
1. Define input schema: `{}` (no inputs)
2. Load `.knowledge/index.json`
3. Return formatted string:
   ```
   Knowledge Index Status
   Last built: <lastBuilt>
   Files indexed: <fileCount>
   Symbols: <hasSymbols>
   Dependencies: <hasDependencies>
   Modules: <modules.join(', ')>
   ```
4. If index.json missing: `"Knowledge not built. Run: npm run build-knowledge"`

**Expected Output:** `mcp-server/tools/health-check.ts` (~30 LOC)

**Acceptance Criteria:**
- Returns formatted status string when index exists
- Returns build instruction when index missing

---

## PHASE 7 — FILE WATCHER + LIVE UPDATES

### Task 7.1 — Create incremental update handler

**Objective:** Re-process only a single changed file, not the entire project.

**Files:** `scripts/lib/incremental-updater.ts`

**Context files needed:** `scripts/lib/symbol-extractor.ts`, `scripts/lib/summary-cache.ts`, `scripts/lib/dependency-extractor.ts`, `src/types.ts`

**Implementation Steps:**
1. Export async function `handleFileChange(filePath: string, projectRoot: string, summarizer: Summarizer): Promise<void>`
2. Load existing `symbols.json`; remove entries where `entry.file === relPath`
3. Create ts-morph Project, load just the changed file
4. Extract symbols for that file, run call graph update (only for that file's calls)
5. Re-merge into full symbols list; write back with `atomicWrite`
6. Load summary cache; call `getOrGenerateSummary` for the changed file
7. Write updated summary to `.knowledge/summaries/<relPath>.json`
8. Update `index.json` `lastBuilt` timestamp
9. Log: `"Updated knowledge for: <relPath>"`

**Expected Output:** `scripts/lib/incremental-updater.ts` (~90 LOC)

**Acceptance Criteria:**
- Calling this for one changed file updates symbols and summary for only that file
- Other files' entries in symbols.json are unchanged
- Completes in < 1 second for a single file

---

### Task 7.2 — Create watch.ts script

**Objective:** Watch `src/` for changes and trigger incremental updates.

**Files:** `scripts/watch.ts`

**Context files needed:** `scripts/lib/incremental-updater.ts`, `scripts/lib/summarizer-factory.ts`

**Implementation Steps:**
1. Import `chokidar` and `debounce` (implement simple debounce: `(fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) } }`)
2. Read `--root` CLI arg (default: cwd)
3. Get summarizer from `createSummarizer()`
4. Create watcher: `chokidar.watch('src/**/*.{ts,tsx,js,py,go,rs}', { cwd: root, ignoreInitial: true })`
5. On `add` and `change`: call `debounce(handleFileChange, 500)(absolutePath, root, summarizer)`
6. On `unlink`: remove entries from symbols.json and summaries cache for that file
7. Log: `"Watching for changes in <root>/src/ ..."`

**Expected Output:** `scripts/watch.ts` (~50 LOC)

**Acceptance Criteria:**
- `npm run watch` starts without errors
- Saving a `.ts` file triggers incremental update within 2 seconds
- Deleting a file removes its entries from knowledge

---

## PHASE 8 — CLAUDE MCP INTEGRATION

### Task 8.1 — Create .claude/mcp_servers.json

**Objective:** Register the MCP server with Claude Code.

**Files:** `.claude/mcp_servers.json`

**Implementation Steps:**
1. Create `.claude/` directory
2. Create `.claude/mcp_servers.json`:
   ```json
   {
     "mcpServers": {
       "repo-knowledge": {
         "command": "node",
         "args": ["mcp-server/dist/server.js"],
         "env": {
           "KNOWLEDGE_ROOT": "."
         }
       }
     }
   }
   ```
3. Also create `.claude/mcp_servers.dev.json` for development with tsx:
   ```json
   {
     "mcpServers": {
       "repo-knowledge-dev": {
         "command": "npx",
         "args": ["tsx", "mcp-server/server.ts"]
       }
     }
   }
   ```

**Expected Output:** `.claude/mcp_servers.json` and `.claude/mcp_servers.dev.json`

**Acceptance Criteria:**
- Both files are valid JSON
- `command` and `args` correctly reference the server

---

### Task 8.2 — Build MCP server compilation config

**Objective:** Enable `npm run build-mcp` to compile MCP server for production.

**Files:** `package.json` (verify `build-mcp` script), `tsconfig.mcp.json` (verify from Task 1.2)

**Implementation Steps:**
1. Verify `tsconfig.mcp.json` outputs to `mcp-server/dist/`
2. Update `build-mcp` script in package.json: `"build-mcp": "tsc --project tsconfig.mcp.json && echo 'MCP server built to mcp-server/dist/'"`
3. Add `"prebuild-mcp": "rm -rf mcp-server/dist"` to clean before build

**Expected Output:** Updated `package.json`

**Acceptance Criteria:**
- `npm run build-mcp` produces `mcp-server/dist/server.js`
- `node mcp-server/dist/server.js` starts without errors

---

## PHASE 9 — TESTING + VALIDATION

### Task 9.1 — Create sample TypeScript fixture project

**Objective:** Deterministic test fixture with known symbol relationships.

**Files:** `test/fixtures/sample-project/src/orders/order.service.ts`, `test/fixtures/sample-project/src/payments/payment.service.ts`, `test/fixtures/sample-project/src/analytics/analytics.service.ts`, `test/fixtures/sample-project/tsconfig.json`

**Implementation Steps:**
Create 3 files with these exact relationships:
- `OrderService.createOrder()` calls `PaymentService.charge()` and `AnalyticsService.track()`
- `PaymentService.charge()` throws `PaymentDeclined` error class
- `AnalyticsService.track()` is a leaf (calls nothing in project)
- All classes and methods are exported

**Expected Output:** 4 files in `test/fixtures/sample-project/`

**Acceptance Criteria:**
- All files compile with `tsc --noEmit`
- Relationships are clear and deterministic for testing

---

### Task 9.2 — Write symbol extractor unit tests

**Objective:** Test that symbol extraction works correctly on the fixture project.

**Files:** `test/symbol-extractor.test.ts`

**Context files needed:** `scripts/lib/symbol-extractor.ts`, `scripts/lib/call-graph.ts`, `test/fixtures/`

**Implementation Steps:**
Use Vitest. Write tests for:
1. `extractSymbols` returns 2 symbols for `order.service.ts` (the class + the method, or just the method)
2. `buildCallGraph` populates `calls` for `createOrder` with `PaymentService.charge` and `AnalyticsService.track`
3. `invertCallGraph` populates `calledBy` for `PaymentService.charge` with `OrderService.createOrder`

**Expected Output:** `test/symbol-extractor.test.ts` (~60 LOC)

**Acceptance Criteria:**
- All 3 tests pass: `npm test`

---

### Task 9.3 — Write dependency graph unit tests

**Objective:** Test dependency extraction and graph building on fixture project.

**Files:** `test/dependency-graph.test.ts`

**Context files needed:** `scripts/lib/dependency-extractor.ts`, `scripts/lib/dependency-graph.ts`, `test/fixtures/`

**Implementation Steps:**
Use Vitest. Write tests for:
1. `extractFileDeps` for `order.service.ts` returns path to `payment.service.ts` and `analytics.service.ts`
2. `buildDependencyGraph` includes edge `orders → payments`
3. Cycle detection: create a 2-file fixture with circular imports; assert it appears in `cycles`

**Expected Output:** `test/dependency-graph.test.ts` (~70 LOC)

**Acceptance Criteria:**
- All 3 tests pass: `npm test`

---

### Task 9.4 — Write MCP tool integration tests

**Objective:** End-to-end test: build knowledge for fixture, test each tool.

**Files:** `test/mcp-tools.test.ts`

**Context files needed:** All mcp-server/tools/ files, `test/fixtures/`

**Implementation Steps:**
Use Vitest. In `beforeAll`: run build-knowledge on the fixture project.
Write tests for:
1. `findSymbol({ name: 'createOrder' })` returns 1 result with correct file and line
2. `findCallers({ symbol: 'PaymentService.charge' })` returns `OrderService.createOrder` as a caller
3. `getDependencies({ module: 'orders' })` returns `['payments', 'analytics']` in direct deps
4. `getFileSummary({ file: 'src/orders/order.service.ts' })` returns `FileSummary` with `exports` containing `createOrder`
5. `healthCheck({})` returns status string with `fileCount >= 3`

**Expected Output:** `test/mcp-tools.test.ts` (~100 LOC)

**Acceptance Criteria:**
- All 5 tests pass: `npm test`

---

### Task 9.5 — Performance benchmark

**Objective:** Verify build-knowledge completes in < 10s for 500 files.

**Files:** `test/perf.test.ts`

**Implementation Steps:**
1. Create `generateFixtureFiles(count: number, dir: string)` helper that creates `count` TypeScript files with random exported functions
2. Write test: generate 500 files, time `build-knowledge` execution, assert < 10000ms
3. Clean up generated files after test

**Expected Output:** `test/perf.test.ts` (~50 LOC)

**Acceptance Criteria:**
- Test passes (< 10 seconds for 500 files in static summarizer mode)
- Generated files are cleaned up after test

---

## Summary

### Estimated Development Effort

| Phase | Tasks | Effort (weak agent) | Risk |
|---|---|---|---|
| 1: Bootstrap | 6 | 0.5 day | Low |
| 2: Symbol Indexer | 4 | 1–2 days | Medium |
| 3: Dependency Graph | 4 | 1–2 days | Medium |
| 4: LLM Summaries | 6 | 1–2 days | Medium |
| 5: Storage | 3 | 0.5 day | Low |
| 6: MCP Server | 7 | 1–2 days | Low-Medium |
| 7: File Watcher | 2 | 0.5 day | Low |
| 8: Integration | 2 | 0.5 day | Low |
| 9: Testing | 5 | 2–3 days | Low |
| **Total** | **39 tasks** | **~3–4 weeks** | |

### Estimated Code Size

| Component | LOC |
|---|---|
| src/types.ts | ~50 |
| scripts/lib/ (all) | ~500 |
| scripts/*.ts (entry points) | ~300 |
| mcp-server/ | ~450 |
| test/ | ~400 |
| Config files | ~100 |
| **Total** | **~1,800 LOC** |

### Implementation Risks

1. **ts-morph call graph resolution** — Some call expressions won't resolve (aliased imports, dynamic calls, interface method dispatch). Mitigation: Fall back to unresolved; log warnings.
2. **MCP stdio protocol** — Errors written to stdout will corrupt the protocol. All logs must go to stderr. This is easy to get wrong.
3. **Circular dependency detection** — DFS cycle detection in large repos can be slow if not bounded. Mitigation: Set max traversal depth = 10.
4. **LLM JSON parsing** — LLMs sometimes return malformed JSON in code fences. `parseResponse` must handle this gracefully.
5. **File path normalization** — Windows `\` vs Unix `/` path separators will break lookups. Mitigation: Normalize all paths to `/` using `path.posix`.

### Suggested Execution Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6 (partial) → Phase 9 (partial)
→ Phase 4 → Phase 7 → Phase 8 → Phase 9 (complete)
```

**Why:** Get the deterministic pipeline (symbol graph + dependency graph + storage + MCP) working and testable first. Add LLM summaries (Phase 4) and live watch (Phase 7) only after the core is validated. This delivers 80% of value at 50% of the effort — matching the ARCHITECTURE_EVALUATION.md recommendation.

### Verification (end-to-end test)

1. Clone a real TypeScript project (e.g., NestJS sample app, ~200 files)
2. Run `npm run build-knowledge` — should complete in < 10s
3. Start MCP dev server: `npx tsx mcp-server/server.ts`
4. In Claude Code, call `find_symbol("createOrder")` — should return correct file/line
5. Call `get_dependencies("orders")` — should return payment/analytics deps
6. Modify a source file, run `npm run watch` — within 2 seconds, call `get_file_summary` again and verify it reflects the change
7. Run `npm test` — all tests pass
