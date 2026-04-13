# AI Code Knowledge System — Comprehensive Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Installation & Setup](#installation--setup)
5. [Configuration](#configuration)
6. [CLI Scripts](#cli-scripts)
7. [MCP Server & Tools](#mcp-server--tools)
8. [Knowledge Artifacts](#knowledge-artifacts)
9. [Type System](#type-system)
10. [Summarizer Backends](#summarizer-backends)
11. [Incremental Updates & File Watching](#incremental-updates--file-watching)
12. [Testing](#testing)
13. [Git Hooks](#git-hooks)
14. [Troubleshooting](#troubleshooting)

---

## Overview

The AI Code Knowledge System extracts structured intelligence from TypeScript codebases and exposes it through the **Model Context Protocol (MCP)**. It produces four knowledge artifacts — symbols, dependencies, summaries, and an index — that AI agents can query via six MCP tools without scanning the entire codebase.

**Core capabilities:**
- Symbol extraction (functions, classes, interfaces, type aliases, methods, arrow functions)
- Call graph construction with bidirectional `calls`/`calledBy` resolution
- Module-level dependency graph with cycle detection
- LLM-powered or static file summaries with content-hash caching
- Incremental updates via file watching (sub-second per file)
- Atomic writes to prevent data corruption

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Knowledge Generator                 │
│  scripts/build-knowledge.ts  (full build)            │
│  scripts/watch.ts            (incremental watcher)   │
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │   Symbol      │ │  Dependency  │ │  Summarizer  │ │
│  │   Extractor   │ │  Extractor   │ │  (3 modes)   │ │
│  │  + Call Graph │ │  + Graph     │ │              │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────┬────────────────────────────┬────────────┘
             │         writes             │
             ▼                            ▼
┌─────────────────────────────────────────────────────┐
│               .knowledge/ directory                  │
│  symbols.json  dependencies.json  summaries/cache.json│
│  index.json    architecture.md                       │
└────────────┬────────────────────────────────────────┘
             │         reads
             ▼
┌─────────────────────────────────────────────────────┐
│                  MCP Tool Server                     │
│  mcp-server/server.ts  (stdio transport)             │
│                                                      │
│  Tools: find_symbol, find_callers, get_dependencies, │
│         get_file_summary, search_architecture,       │
│         health_check                                 │
└─────────────────────────────────────────────────────┘
```

**Three layers:**
1. **Knowledge Generator** — Scripts that parse TypeScript via ts-morph and produce JSON artifacts
2. **Knowledge Storage** — `.knowledge/` directory with JSON files and markdown
3. **MCP Tool Server** — Node.js process communicating via stdio, reading from `.knowledge/`

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build the knowledge base (full build)
npm run build-knowledge

# 3. Build the MCP server
npm run build-mcp

# 4. Start the MCP server
npm run start-mcp

# 5. (Optional) Start the file watcher for incremental updates
npm run watch
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+ (ES2022 target)
- npm

### Install dependencies
```bash
npm install
```

### Key dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `ts-morph` | ^23.0.0 | TypeScript AST parsing and analysis |
| `@anthropic-ai/sdk` | ^0.36.3 | Anthropic API client (optional summarizer) |
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP server framework |
| `chokidar` | ^3.6.0 | File system watcher |
| `zod` | ^3.23.0 | Schema validation for MCP tool parameters |
| `tsx` | ^4.19.0 | TypeScript execution (dev) |
| `vitest` | ^2.0.0 | Test runner (dev) |

### Install git hooks (optional)
```bash
npm run install-hooks
```

This installs a pre-commit hook that rebuilds the knowledge base and auto-stages `.knowledge/` before each commit.

---

## Configuration

### Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SUMMARIZER_MODE` | `'static'` | No | Summarizer backend: `'static'`, `'ollama'`, or `'anthropic'` |
| `OLLAMA_BASE_URL` | `'http://localhost:11434'` | No | Ollama API endpoint (only when mode=ollama) |
| `OLLAMA_MODEL` | `'qwen2.5-coder:7b'` | No | Ollama model name (only when mode=ollama) |
| `ANTHROPIC_API_KEY` | — | When mode=anthropic | Anthropic API key for Claude-based summaries |
| `KNOWLEDGE_ROOT` | `'.knowledge'` | No | Path to knowledge base directory (MCP server) |

### TypeScript Configuration

**`tsconfig.json`** — Main config for scripts and source:
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

**`tsconfig.mcp.json`** — Separate config for MCP server compilation:
```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "rootDir": "mcp-server",
        "outDir": "mcp-server/dist"
    },
    "include": ["mcp-server/**/*"]
}
```

The MCP server has its own tsconfig because `rootDir: "mcp-server"` prevents importing from `src/`. Types are synced via `npm run sync-types` instead.

---

## CLI Scripts

### `npm run build-knowledge`

Full knowledge base build. Runs four phases sequentially.

```bash
# Full build
npm run build-knowledge

# With custom project root
npx tsx scripts/build-knowledge.ts --root /path/to/project

# Incremental mode (only reprocesses changed files for symbols/summaries)
npm run build-knowledge:incremental
```

**CLI Arguments:**
| Argument | Default | Description |
|----------|---------|-------------|
| `--root <path>` | `process.cwd()` | Project root directory |
| `--incremental` | `false` | Skip unchanged files (checked via SHA-256 content hash) |

**Four Phases:**

| Phase | Output File | Incremental? | Description |
|-------|-------------|--------------|-------------|
| 1. Symbols | `symbols.json` | Yes | Extract symbols, build call graph, invert for calledBy |
| 2. Dependencies | `dependencies.json` | No (always full) | Extract file imports, build module graph, detect cycles |
| 3. Summaries | `summaries/cache.json` | Yes | Generate file summaries (static, Ollama, or Anthropic) |
| 4. Index | `index.json` | N/A | Aggregate metadata from all artifacts |

### `npm run watch`

Starts a file watcher for incremental updates using chokidar.

```bash
npm run watch
npx tsx scripts/watch.ts --root /path/to/project
```

**CLI Arguments:**
| Argument | Default | Description |
|----------|---------|-------------|
| `--root <path>` | `process.cwd()` | Project root directory |

**Configuration Constants:**
| Constant | Value | Description |
|----------|-------|-------------|
| `DEBOUNCE_MS` | 500 | Milliseconds to wait before processing accumulated changes |
| `WATCH_GLOB` | `'src/**/*.{ts,tsx,js,py,go,rs}'` | File patterns to watch |

**Watched Events:**
- `add` — New file created → processes as change
- `change` — File modified → re-extracts symbols, rebuilds call graph, updates summary
- `unlink` — File deleted → removes symbols, cleans calledBy references

**Graceful Shutdown:** Handles SIGINT and SIGTERM signals.

### `npm run build-mcp`

Compiles the MCP server TypeScript to JavaScript.

```bash
npm run build-mcp    # Runs sync-types + clean + tsc
npm run start-mcp    # Starts compiled server
```

The `prebuild-mcp` script automatically:
1. Syncs `src/types.ts` → `mcp-server/types.ts` (with auto-generated header)
2. Cleans `mcp-server/dist/`

### `npm run test`

Runs the full test suite with vitest.

```bash
npm run test           # All tests
npx vitest run test/perf.test.ts  # Single test file
```

### `npm run sync-types`

Copies `src/types.ts` to `mcp-server/types.ts` with an auto-generated header comment. Run this after modifying `src/types.ts`.

### `npm run install-hooks`

Installs a git pre-commit hook that runs `npm run build-knowledge` and stages `.knowledge/` automatically.

---

## MCP Server & Tools

### Starting the Server

```bash
npm run build-mcp && npm run start-mcp
```

The server communicates via **stdio** (stdin/stdout) using the Model Context Protocol. All log output goes to stderr.

**Server Identity:**
```
name: "ai-code-knowledge"
version: "0.1.0"
```

### Tool Reference

#### `find_symbol`

Locate class, function, or interface definitions across the project.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | `string` | Yes | Symbol name or substring to search for |
| `type` | `string` | No | Filter by symbol type: `function`, `class`, `interface`, `type`, `method` |

**Behavior:**
- Case-insensitive substring match on symbol name
- Results sorted by name length (shorter = more exact match first)
- Limited to 20 results

**Example request:**
```json
{ "name": "create", "type": "function" }
```

**Example response:**
```
Found 3 symbol(s) matching "create" [type: function]:

Name:      createOrder
Type:      function
File:      src/order-service.ts
Line:      10
Signature: export function createOrder(items: Item[]): Order
```

---

#### `find_callers`

Identify all symbols that call a specific function or class method using BFS traversal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `symbol` | `string` | Yes | Fully-qualified symbol name (e.g., `OrderService.createOrder`) |
| `maxDepth` | `number` | No | BFS traversal depth (default: 1, min: 1) |

**Behavior:**
- Exact match on `qualifiedName` (case-insensitive)
- BFS traversal through `calledBy` references
- Deduplicates results (no symbol appears twice)
- Shows depth-indented output

**Example request:**
```json
{ "symbol": "charge", "maxDepth": 2 }
```

**Example response:**
```
Callers of "charge" (maxDepth: 2):

  createOrder — src/order-service.ts:10
    processCheckout — src/checkout-service.ts:25
```

---

#### `get_dependencies`

Retrieve module-level dependency relationships via BFS traversal.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `module` | `string` | Yes | Module name to look up |
| `depth` | `number` | No | BFS traversal depth (default: 1, min: 1) |

**Behavior:**
- Traverses module-level edges from `dependencies.json`
- Shows dependency type (direct vs dynamic import)
- If module not found, lists available modules

**Example request:**
```json
{ "module": "services", "depth": 2 }
```

**Example response:**
```
Dependencies for "services" (depth: 2):

  utils (direct)
    models (direct)
  models (dynamic)
```

---

#### `get_file_summary`

Get a high-level overview of a file's purpose, exports, and dependencies.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | `string` | Yes | Relative file path (e.g., `src/lib/foo.ts` or just `foo.ts`) |

**Behavior:**
- Normalizes path: strips `./` and `/` prefix, appends `.ts` if no extension
- Blocks path traversal attempts (rejects paths containing `..`)
- First tries exact match, then suffix match
- If not found, lists first 10 available file paths

**Example request:**
```json
{ "file": "order-service" }
```

**Example response:**
```
File: src/order-service.ts
Purpose: Handles order creation and orchestrates payment processing
Exports: createOrder, OrderService
Dependencies: ./payment-service, ./analytics-service
Side Effects: writes to database
Throws: PaymentDeclined
Last Updated: 2026-03-16T12:00:00.000Z
```

---

#### `search_architecture`

Query the human-authored architecture documentation for system-wide patterns.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | Case-insensitive search query |

**Behavior:**
- Searches `.knowledge/architecture.md` line by line
- Returns matching lines with ±3 lines of context
- Merges overlapping context ranges
- Prefixes each line with `[architecture.md:LINE_NUMBER]`

**Example request:**
```json
{ "query": "authentication" }
```

**Example response:**
```
[architecture.md:14] ## Authentication
[architecture.md:15] The auth module handles JWT validation and session management.
[architecture.md:16] It depends on the crypto and config modules.
```

---

#### `health_check`

Check the status of the knowledge base.

**Parameters:** None

**Example response:**
```
=== Knowledge Base Status ===

Last Built:       2026-03-16T12:00:00.000Z
File Count:       14
Has Symbols:      yes
Has Dependencies: yes

Modules:
  - services
  - utils
  - models
```

---

## Knowledge Artifacts

All artifacts are stored in the `.knowledge/` directory at the project root.

### `symbols.json`

**Type:** `SymbolEntry[]` — JSON array of symbol objects.

Each entry represents a function, class, interface, type alias, or method extracted from the codebase.

```json
[
  {
    "name": "createOrder",
    "qualifiedName": "createOrder",
    "file": "src/order-service.ts",
    "line": 10,
    "signature": "export function createOrder(items: Item[]): Order",
    "type": "function",
    "module": "order-service",
    "calls": ["charge", "track"],
    "calledBy": ["processCheckout"],
    "throws": ["PaymentDeclined"],
    "isExported": true
  }
]
```

**Symbol types detected:**
- `function` — Named function declarations AND arrow/function expressions assigned to `const`/`let`/`var`
- `class` — Class declarations
- `method` — Methods inside classes (qualified as `ClassName.methodName`)
- `interface` — Interface declarations
- `type` — Type alias declarations

### `dependencies.json`

**Type:** `DependencyGraph` — Module-level dependency graph with cycle detection.

```json
{
  "nodes": ["services", "utils", "models"],
  "edges": [
    { "from": "services", "to": "utils", "type": "direct" },
    { "from": "services", "to": "models", "type": "dynamic" }
  ],
  "cycles": [["a", "b", "a"]],
  "fileDeps": {
    "src/services/order.ts": ["src/utils/helpers.ts"]
  }
}
```

**Edge types:**
- `direct` — Static `import` or `export ... from`
- `dynamic` — Dynamic `import()` expressions

**Module grouping:** Files are grouped by parent directory name (e.g., files in `src/services/` → module `"services"`).

### `summaries/cache.json`

**Type:** `Record<string, FileSummary>` — Maps relative file paths to their summaries.

```json
{
  "src/order-service.ts": {
    "file": "src/order-service.ts",
    "purpose": "Handles order creation and orchestrates payment processing",
    "exports": ["createOrder", "OrderService"],
    "dependencies": ["./payment-service", "./analytics-service"],
    "sideEffects": ["writes to database"],
    "throws": ["PaymentDeclined"],
    "lastUpdated": "2026-03-16T12:00:00.000Z",
    "contentHash": "a1b2c3d4..."
  }
}
```

Summaries are cached by SHA-256 content hash. Unchanged files are not re-summarized.

### `index.json`

**Type:** `KnowledgeIndex` — Aggregated metadata about the knowledge base.

```json
{
  "modules": ["services", "utils"],
  "summaries": ["src/order-service.ts"],
  "hasSymbols": true,
  "hasDependencies": true,
  "lastBuilt": "2026-03-16T12:00:00.000Z",
  "fileCount": 14
}
```

### `architecture.md`

**Format:** Human-authored markdown describing system architecture. Not auto-generated — users create and maintain this file. Searched by the `search_architecture` MCP tool.

---

## Type System

All types are defined in `src/types.ts` and synced to `mcp-server/types.ts` via `npm run sync-types`.

### `SymbolEntry`
```typescript
export interface SymbolEntry {
    name: string;           // Symbol identifier (e.g., "createOrder")
    qualifiedName: string;  // Qualified name (e.g., "OrderService.createOrder")
    file: string;           // Relative file path
    line: number;           // Start line number
    signature: string;      // Type signature up to first { at depth 0
    type: 'function' | 'class' | 'interface' | 'type' | 'method';
    module: string;         // Parent directory name
    calls: string[];        // qualifiedNames of symbols this calls
    calledBy: string[];     // qualifiedNames of symbols that call this
    throws: string[];       // Exception types thrown
    isExported: boolean;    // Whether the symbol is exported
}
```

### `DependencyGraph`
```typescript
export interface DependencyGraph {
    nodes: string[];        // Module names
    edges: Array<{ from: string; to: string; type: 'direct' | 'dynamic' }>;
    cycles: string[][];     // Detected circular dependency paths
    fileDeps: Record<string, string[]>;  // File-level dependency map
}
```

### `FileSummary`
```typescript
export interface FileSummary {
    file: string;           // Relative file path
    purpose: string;        // Semantic description of the file
    exports: string[];      // Exported symbol names
    dependencies: string[]; // Import paths
    sideEffects: string[];  // I/O, network, global state effects
    throws: string[];       // Documented exception types
    lastUpdated: string;    // ISO timestamp
    contentHash: string;    // SHA-256 hex string of file content
}
```

### `KnowledgeIndex`
```typescript
export interface KnowledgeIndex {
    modules: string[];      // Available module names
    summaries: string[];    // Files with generated summaries
    hasSymbols: boolean;    // Whether symbols.json exists
    hasDependencies: boolean; // Whether dependencies.json exists
    lastBuilt: string;      // ISO timestamp of last full build
    fileCount: number;      // Number of unique source files
}
```

### `CallSite`
```typescript
export interface CallSite {
    caller: string;         // Qualified name of the calling symbol
    file: string;           // File containing the call
    line: number;           // Line number of the call
    callChain: string[];    // Chain of calls leading to this site
}
```

### `SummarizerMode`
```typescript
export type SummarizerMode = 'static' | 'ollama' | 'anthropic';
```

---

## Summarizer Backends

The system supports three summarizer backends, selected via the `SUMMARIZER_MODE` environment variable.

### Static Summarizer (default)

No external API calls. Generates summaries from code structure alone.

```bash
SUMMARIZER_MODE=static npm run build-knowledge
# or simply:
npm run build-knowledge  # static is the default
```

**How it works:**
- **purpose**: Derived from filename (e.g., `"order-service module"`)
- **exports**: Symbols where `isExported === true`
- **dependencies**: Regex-extracted from import statements
- **sideEffects**: Always `[]` (cannot be determined statically)
- **throws**: Aggregated from symbol `throws` arrays

### Ollama Summarizer

Uses a locally-running Ollama instance for LLM-powered summaries.

```bash
SUMMARIZER_MODE=ollama npm run build-knowledge

# Optional: customize endpoint and model
SUMMARIZER_MODE=ollama \
  OLLAMA_BASE_URL=http://localhost:11434 \
  OLLAMA_MODEL=qwen2.5-coder:7b \
  npm run build-knowledge
```

**Configuration:**
| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model to use |

**API call:** `POST {baseUrl}/api/generate` with 10-second timeout. Falls back to static summarizer on failure.

### Anthropic Summarizer

Uses the Claude API for high-quality summaries.

```bash
SUMMARIZER_MODE=anthropic \
  ANTHROPIC_API_KEY=sk-ant-... \
  npm run build-knowledge
```

**Configuration:**
| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required.** Throws if missing. |

**Model used:** `claude-haiku-4-5-20251001` (fast, cost-effective). Max tokens: 1024.

---

## Incremental Updates & File Watching

### How incremental builds work

When `--incremental` is passed to `build-knowledge`, or when the watcher processes a file change:

1. **Content hash check**: SHA-256 of the file content is compared against the cached hash in `summaries/cache.json`
2. **Symbol extraction**: Only the changed file is re-parsed via ts-morph
3. **Call graph rebuild**: The full project is loaded into ts-morph so cross-file call resolution works correctly. All symbols (existing + new) are merged, then the call graph is rebuilt over the full set.
4. **Summary regeneration**: Only the changed file's summary is regenerated
5. **Atomic writes**: Both `symbols.json` and `summaries/cache.json` are written atomically (write-to-temp-then-rename)

### File watcher details

```bash
npm run watch
```

**Watched patterns:** `src/**/*.{ts,tsx,js,py,go,rs}`

**Debounce:** Changes within 500ms are batched together. The watcher waits for write stability (100ms threshold, 50ms poll interval) before processing.

**Events handled:**
- **File added/changed**: `handleFileChange()` — re-extracts symbols, rebuilds call graph, updates summary
- **File deleted**: `handleFileDeletion()` — removes symbols, cleans stale `calls`/`calledBy` references

### Atomic writes

All knowledge artifact writes use the atomic write pattern:
1. Write to `{path}.{uuid}.tmp`
2. Rename temp file to target path (atomic OS operation)
3. On failure: best-effort cleanup of temp file

This prevents partial writes and data corruption if the process crashes mid-write.

---

## Testing

### Running tests

```bash
npm run test                           # All tests
npx vitest run test/perf.test.ts       # Single file
npx vitest run --reporter=verbose      # Verbose output
```

### Test files

| File | Scope | Description |
|------|-------|-------------|
| `test/mcp-tools.test.ts` | Integration | End-to-end tests for all 6 MCP tools against sample project |
| `test/find-symbol.test.ts` | Unit | find_symbol handler: matching, filtering, sorting |
| `test/find-callers.test.ts` | Unit | find_callers handler: BFS, dedup, diamond graphs, corrupted JSON |
| `test/get-dependencies.test.ts` | Unit | get_dependencies handler: BFS, module listing, corrupted JSON |
| `test/get-file-summary.test.ts` | Unit | get_file_summary handler: normalization, suffix match, path traversal |
| `test/search-architecture.test.ts` | Unit | Architecture search: case-insensitive, context extraction |
| `test/health-check.test.ts` | Unit | Health check tool status reporting |
| `test/symbol-extractor.test.ts` | Unit | Symbol extraction: functions, classes, interfaces, arrow functions |
| `test/dependency-graph.test.ts` | Unit | Dependency graph: cycle detection, module grouping |
| `test/index-builder.test.ts` | Unit | Index generation and metadata aggregation |
| `test/incremental-updater.test.ts` | Integration | Incremental updates: cross-file calls, deletion cleanup |
| `test/perf.test.ts` | Performance | Benchmark: 500 files must process in <10 seconds |

### Test fixtures

Located in `test/fixtures/sample-project/`:
- `order-service.ts` — Defines `createOrder()` that calls `charge()` and `track()`
- `payment-service.ts` — Defines `charge()` function
- `analytics-service.ts` — Defines `track()` function and `formatEvent` arrow function

### Test patterns used

- **Fixture copy-to-temp**: Integration tests copy fixtures to temp directories for safe mutation
- **Subprocess execution**: Integration tests run `tsx scripts/build-knowledge.ts --root {tmpDir}` as a child process
- **Cleanup**: `afterAll()` hooks remove temp directories

---

## Git Hooks

### Pre-commit hook

Install with:
```bash
npm run install-hooks
```

This creates `.git/hooks/pre-commit` with:
```bash
#!/bin/sh
npm run build-knowledge
git add .knowledge/
```

**Effect:** Every commit automatically rebuilds the knowledge base and stages the updated artifacts, ensuring the knowledge base is always in sync with the code.

---

## Troubleshooting

### "Knowledge base not found"
Run `npm run build-knowledge` to generate the initial knowledge base.

### Stale knowledge base
Check `.knowledge/index.json` for the `lastBuilt` timestamp. If stale, run:
```bash
npm run build-knowledge
```

### MCP server won't start
1. Ensure the server is built: `npm run build-mcp`
2. Ensure knowledge base exists: `npm run build-knowledge`
3. Check `KNOWLEDGE_ROOT` env var points to the correct `.knowledge/` directory

### Corrupted JSON in `.knowledge/`
The MCP tools handle corrupted JSON gracefully (return error responses instead of crashing). Fix by rebuilding:
```bash
npm run build-knowledge
```

### Anthropic summarizer fails
- Verify `ANTHROPIC_API_KEY` is set and valid
- Verify `SUMMARIZER_MODE=anthropic` is set
- The system falls back to static summarizer on API errors

### Ollama summarizer fails
- Verify Ollama is running at the configured `OLLAMA_BASE_URL`
- Verify the model is pulled: `ollama pull qwen2.5-coder:7b`
- Requests time out after 10 seconds

### Watch mode not detecting changes
- Verify files match the watch glob: `src/**/*.{ts,tsx,js,py,go,rs}`
- Check for write stability issues (files being written in chunks)
- The watcher debounces for 500ms — rapid edits are batched

### Path traversal error from `get_file_summary`
The tool rejects file paths containing `..` for security. Use relative paths from the project root (e.g., `src/services/order.ts`).
