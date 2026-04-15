# ai-code-knowledge

Extract structured knowledge from codebases and expose it to AI agents via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

AI coding agents typically scan entire repositories to understand code — burning tokens and time. This tool builds a persistent knowledge base (symbols, call graphs, dependency maps, file summaries, vector indexes) that agents can query through MCP tools instead.

**Result:** 70-90% reduction in token usage and repo scanning for AI agents.

## Overview

```
 Repository                .knowledge/                MCP Server
 ──────────    build      ─────────────    stdio     ──────────────
  Source    ──────────►   symbols.json  ◄──────────   AI Agent
  Files       watch       dependencies     query      (Claude, etc.)
              (live)      summaries/
                          graph/
                          vectors/
                          index.json
```

1. **Build** — Parse your codebase to extract symbols, call graphs, dependency maps, file summaries, vector indexes, and a knowledge graph
2. **Store** — Persist everything as JSON in `.knowledge/`
3. **Serve** — AI agents query the MCP server instead of scanning files

## Quick start (one command)

```bash
git clone https://github.com/amangcoder/ai-code-knowledge.git
cd ai-code-knowledge
pnpm run setup        # install deps, build knowledge base, build MCP server
```

The setup script auto-detects pnpm/npm, builds the knowledge base using the static summarizer (no API keys needed), and compiles the MCP server.

For full vector search and semantic feature discovery (recommended):

```bash
pnpm run setup:full   # also installs Python deps, starts embedding server, builds vectors
```

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Python 3.8+ (only for local embedding server)

## Setup guide

The system is modular — pick the configuration that fits your needs.

### 1. Minimal (zero external dependencies)

Works out of the box. Summaries are derived from code structure, no vector search.

```bash
pnpm install
pnpm run build-knowledge
pnpm run build-mcp
pnpm run start-mcp
```

This gives you all MCP tools except `semantic_search` and `get_feature_context`.

### 2. Local embeddings with CodeSage (recommended)

Adds vector search and feature discovery using a local Python embedding server. Fully offline after initial model download.

**Option A — one command (auto-manages the embedding server):**

```bash
pip3 install -r scripts/requirements.txt
pnpm run embed:build -- --root /path/to/your/project
```

This starts the embedding server, waits for it to be ready, runs a full rich build, then shuts it down. It also writes `.mcp.json` and `CLAUDE.md` directly into your project.

**Option B — two terminals (keep the server running for repeated builds):**

Terminal 1:
```bash
pnpm run embed:start          # CPU
pnpm run embed:start:gpu      # Apple Silicon (MPS)
```

Terminal 2 (once server is ready):
```bash
pnpm run embed:build -- --root /path/to/your/project
```

The embedding server supports GPU acceleration via `--device`:

```bash
python3 scripts/embedding-server.py --device mps    # Apple Silicon
python3 scripts/embedding-server.py --device cuda   # NVIDIA GPU
python3 scripts/embedding-server.py --device cpu    # default
```

### 3. Cloud-powered (Anthropic + HuggingFace)

Uses Claude for high-quality file summaries and HuggingFace for embeddings. Requires API keys.

```bash
cp .env.example .env

# Edit .env and set:
#   SUMMARIZER_MODE=anthropic
#   ANTHROPIC_API_KEY=sk-ant-...
#   EMBEDDING_MODEL=huggingface
#   HF_API_TOKEN=hf_...        (optional, increases rate limits)

pnpm run build-knowledge
pnpm run build-mcp
pnpm run start-mcp
```

### 4. Fully local with Ollama

Uses Ollama for both summaries and embeddings. No cloud APIs, no Python — just Ollama.

```bash
# Install Ollama: https://ollama.com
ollama pull qwen2.5-coder:7b      # summarizer model
ollama pull nomic-embed-text       # embedding model

SUMMARIZER_MODE=ollama EMBEDDING_MODEL=ollama pnpm run build-knowledge
pnpm run build-mcp
pnpm run start-mcp
```

## Integrating with your project

### Step 1: Build the knowledge base for your project

**With embeddings (recommended) — auto-creates `.mcp.json` and `CLAUDE.md` in your project:**

```bash
pnpm run embed:build -- --root /path/to/your/project
```

**Without embeddings:**

```bash
pnpm run build-knowledge -- --root /path/to/your/project
```

Additional flags:

```bash
# Only reprocess changed files
pnpm run build-knowledge -- --root /path/to/your/project --incremental

# Exclude directories (e.g., vendor code, generated files)
pnpm run build-knowledge -- --root /path/to/your/project --exclude vendor,generated

# Skip vector index generation
pnpm run build-knowledge -- --root /path/to/your/project --skip-vectors
```

This creates a `.knowledge/` directory inside your project with the extracted artifacts.

> **Excluding directories:** For persistent exclusions, create `.knowledge/config.json` in your project:
> ```json
> { "exclude": ["frontend/.next", "src/generated"] }
> ```
> Common build artifact directories (`.next`, `dist`, `build`, `coverage`, etc.) are excluded automatically.

### Step 2: Connect an AI agent

If you used `embed:build`, `.mcp.json` is already written to your project — skip to Step 3.

Otherwise, add the config manually:

#### Claude Code (CLI and IDE extensions)

Add to your project's `.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/ai-code-knowledge/mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": "/absolute/path/to/your/project/.knowledge",
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Or for development (runs TypeScript directly, no build step):

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ai-code-knowledge/mcp-server/server.ts"],
      "env": {
        "KNOWLEDGE_ROOT": "/absolute/path/to/your/project/.knowledge",
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

> **Always use absolute paths** for `KNOWLEDGE_ROOT` and `PROJECT_ROOT` when the MCP server is installed in a different directory than the project being indexed. Relative paths resolve against the server's working directory, not your project root.

#### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/ai-code-knowledge/mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": "/absolute/path/to/your/project/.knowledge",
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/ai-code-knowledge/mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": "/absolute/path/to/your/project/.knowledge",
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

#### Any MCP-compatible client

```bash
PROJECT_ROOT=/path/to/project KNOWLEDGE_ROOT=/path/to/project/.knowledge node /path/to/ai-code-knowledge/mcp-server/dist/server.js
```

Pass the process's stdin/stdout to your MCP client. All logs go to stderr.

### Step 3: Keep knowledge up to date

```bash
# Watch mode — rebuilds incrementally on file changes (no embeddings)
pnpm run watch -- --root /path/to/your/project

# Full rebuild with embeddings
pnpm run embed:build -- --root /path/to/your/project

# Or install a git hook in your project
cd /path/to/your/project
echo '#!/bin/sh
cd /path/to/ai-code-knowledge && pnpm run build-knowledge -- --root '"$(pwd)"'
git add .knowledge/' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Step 4: Add agent instructions

If you used `embed:build`, `CLAUDE.md` is already written to your project.

Otherwise, copy `CLAUDE.md` from this repo into your project root. This tells AI agents to use the MCP tools instead of scanning your codebase directly.

### MCP tools

**Composite tools** (start here — reduce tool calls by 60-70%):

| Tool | Description |
|------|-------------|
| `get_project_overview` | File tree, tech stack, modules, symbol counts, entry points |
| `get_module_context` | Everything about a module: summaries, symbols, deps, patterns |
| `get_implementation_context` | Rich context for a file: summary, symbols, imports, related files |
| `get_batch_summaries` | Compact summaries for up to 20 files in one call |

**Targeted query tools:**

| Tool | Description |
|------|-------------|
| `find_symbol` | Locate class/function/interface definitions by name |
| `find_callers` | Trace call chains via BFS through the call graph |
| `get_dependencies` | Module-level dependency relationships |
| `get_file_summary` | Quick overview of a single file |
| `search_architecture` | Query human-authored architecture docs |
| `semantic_search` | Hybrid BM25 + vector search across files, symbols, and features |
| `explore_graph` | Traverse the knowledge graph by following typed edges (calls, imports, etc.) |
| `get_feature_context` | Look up cross-cutting feature groups by semantic similarity |
| `health_check` | Knowledge base status and freshness |

**Build management:**

| Tool | Description |
|------|-------------|
| `rebuild_knowledge` | Trigger a knowledge base rebuild from within the agent. Supports incremental builds, skip flags, richness levels, and timeout. Returns status, duration, stats, and build log. |

**Pipeline & workspace tools:**

| Tool | Description |
|------|-------------|
| `get_artifact_schema` | Expected JSON schema for pipeline artifact types |
| `get_artifact_store_path` | Filesystem path where a pipeline artifact should be written |
| `validate_artifact_draft` | Pre-validate artifact JSON against expected schema |
| `get_cumulative_context` | Digest of all artifacts produced by prior pipeline phases |
| `get_directory_tree` | File/folder structure as a tree listing |
| `get_code_patterns` | Recurring code patterns with occurrence counts and examples |
| `find_template_file` | Find most similar existing files to use as templates |
| `get_static_data_schema` | Structure of static data files: keys, exports, relationships |

## Configuration

### Summarizer backends

Control how file summaries are generated with `SUMMARIZER_MODE`:

| Mode | API required | Description |
|------|-------------|-------------|
| `static` (default) | None | Derives summaries from code structure alone |
| `ollama` | Local Ollama | Uses a local LLM (default: `qwen2.5-coder:7b`) |
| `anthropic` | `ANTHROPIC_API_KEY` | Uses Claude for high-quality summaries |

### Embedding providers

Vector search is powered by configurable embedding backends via `EMBEDDING_MODEL`:

| Provider | Value | Requirements |
|----------|-------|-------------|
| Local server **(default)** | `local` / `local-base` (768d), `local-large` (1024d) | Python embedding server running |
| HuggingFace | `huggingface` | Optional `HF_API_TOKEN` |
| Ollama | `ollama` | Local Ollama instance |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Mock (CI) | `mock` | None — returns zero vectors |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KNOWLEDGE_ROOT` | `.knowledge` | Path to the `.knowledge` directory |
| `PROJECT_ROOT` | Derived from `KNOWLEDGE_ROOT` | Explicit project root — always set this when running the MCP server for a different project |
| `SUMMARIZER_MODE` | `static` | Summary backend: `static`, `ollama`, `anthropic` |
| `EMBEDDING_MODEL` | `local` | Embedding provider |
| `ANTHROPIC_API_KEY` | — | Required for `anthropic` summarizer |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `HF_API_TOKEN` | — | HuggingFace token (optional, increases rate limits) |

See [.env.example](.env.example) for the full list.

### Excluding directories

Build artifact directories (`.next`, `dist`, `build`, `coverage`, `node_modules`, etc.) are excluded automatically.

For custom exclusions, create `.knowledge/config.json` in your project root:

```json
{
  "exclude": ["src/generated", "vendor/legacy"]
}
```

## Project structure

```
scripts/                  # Knowledge build pipeline
  build-knowledge.ts      # Full build orchestrator (9 phases)
  build-with-embeddings.sh  # One-command build: starts/stops embedding server automatically
  watch.ts                # Incremental file watcher
  embedding-server.py     # Local Python embedding server (CodeSage)
  lib/                    # Extractors, summarizers, embeddings, phases
src/
  types.ts                # Shared type definitions
mcp-server/
  server.ts               # MCP server entry point
  tools/                  # Tool implementations (22 tools)
test/                     # Unit, integration, and perf tests
.knowledge/               # Generated knowledge artifacts (gitignored)
  symbols.json            # All extracted symbols with call graph
  dependencies.json       # Module and file dependency graph
  summaries/cache.json    # Per-file summaries
  graph/                  # Pre-built knowledge graph (nodes + edges)
  vectors/                # Vector indexes for semantic search
  index.json              # Build metadata and health info
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run setup` | One-command setup (install, build knowledge, build MCP) |
| `pnpm run setup:full` | Setup + Python deps, embedding server, vector indexes |
| `pnpm run embed:start` | Start the local embedding server (CPU) |
| `pnpm run embed:start:gpu` | Start the local embedding server (Apple Silicon MPS) |
| `pnpm run embed:build` | Build with embeddings: auto-starts server, full rich build, writes `.mcp.json` + `CLAUDE.md`, stops server |
| `pnpm run embed:build:gpu` | Same as above using GPU acceleration |
| `pnpm run build-knowledge` | Full knowledge base build (no embeddings) |
| `pnpm run build-knowledge:incremental` | Only reprocess changed files |
| `pnpm run build-knowledge:skip-vectors` | Skip vector index generation |
| `pnpm run build-mcp` | Compile the MCP server |
| `pnpm run start-mcp` | Start the MCP server |
| `pnpm run watch` | Incremental rebuilds on file changes |
| `pnpm test` | Run the test suite |
| `pnpm run typecheck` | Type-check the full project |

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — Comprehensive technical reference
- [CLAUDE.md](CLAUDE.md) — Instructions for AI agents using this system
- [PRD.md](PRD.md) — Product requirements document

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and pull request guidelines.

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
