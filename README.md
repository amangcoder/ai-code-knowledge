# ai-code-knowledge

Extract structured knowledge from codebases and expose it to AI agents via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

AI coding agents typically scan entire repositories to understand code — burning tokens and time. This tool builds a persistent knowledge base (symbols, call graphs, dependency maps, file summaries) that agents can query through MCP tools instead.

**Result:** 70-90% reduction in token usage and repo scanning for AI agents.

## Overview

```
 Repository                .knowledge/                MCP Server
 ──────────    build      ─────────────    stdio     ──────────────
  Source    ──────────►   symbols.json  ◄──────────   AI Agent
  Files       watch       dependencies     query      (Claude, etc.)
              (live)      summaries/
                          index.json
```

1. **Build** — Parse your codebase with `ts-morph` to extract symbols, call graphs, dependency maps, and generate file summaries (static, Ollama, or Anthropic-powered)
2. **Store** — Persist everything as JSON in `.knowledge/`
3. **Serve** — AI agents query the MCP server instead of scanning files

## Quick start (one command)

```bash
git clone https://github.com/amangcoder/ai-code-knowledge.git
cd ai-code-knowledge
pnpm run setup        # install deps, build knowledge base, build MCP server
```

That's it. The setup script auto-detects pnpm/npm, builds the knowledge base using the static summarizer (no API keys needed), and compiles the MCP server.

For vector search support (optional):

```bash
pnpm run setup:full   # also installs Python deps and builds vector indexes
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

This gives you all MCP tools except `semantic_search`.

### 2. Local embeddings with CodeSage

Adds vector search using a local Python embedding server. Fully offline after initial model download.

```bash
# Install Python dependencies
pip3 install -r scripts/requirements.txt

# Start the embedding server (runs on port 8484)
python3 scripts/embedding-server.py

# In another terminal — build with local embeddings
EMBEDDING_MODEL=local pnpm run build-knowledge

pnpm run build-mcp
pnpm run start-mcp
```

The embedding server supports GPU acceleration:

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

```bash
# From the ai-code-knowledge directory, point at your project
pnpm run build-knowledge -- --root /path/to/your/project

# For large repos, use incremental mode (only reprocesses changed files)
pnpm run build-knowledge -- --root /path/to/your/project --incremental

# Exclude directories (e.g., vendor code, generated files)
pnpm run build-knowledge -- --root /path/to/your/project --exclude vendor,generated
```

This creates a `.knowledge/` directory inside your project with the extracted artifacts.

### Step 2: Connect an AI agent

#### Claude Code (CLI and IDE extensions)

Add to your project's `.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/ai-code-knowledge/mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
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
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/ai-code-knowledge/mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
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
        "KNOWLEDGE_ROOT": "/absolute/path/to/your/project/.knowledge"
      }
    }
  }
}
```

#### Any MCP-compatible client

The server communicates via stdio. Run it as:

```bash
KNOWLEDGE_ROOT=/path/to/project/.knowledge node /path/to/ai-code-knowledge/mcp-server/dist/server.js
```

Pass the process's stdin/stdout to your MCP client. All logs go to stderr.

### Step 3: Keep knowledge up to date

```bash
# Watch mode — rebuilds incrementally on file changes
pnpm run watch -- --root /path/to/your/project

# Or install a git hook in your project
cd /path/to/your/project
echo '#!/bin/sh
cd /path/to/ai-code-knowledge && pnpm run build-knowledge -- --root '"$(pwd)"'
git add .knowledge/' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Step 4: Add agent instructions (optional)

Copy the `CLAUDE.md` from this repo into your project and customize it. This tells AI agents to use the MCP tools instead of scanning your codebase directly.

### MCP tools

| Tool | Description |
|------|-------------|
| `get_project_overview` | File tree, tech stack, modules, symbol counts, entry points |
| `get_module_context` | Everything about a module: summaries, symbols, deps, patterns |
| `get_implementation_context` | Rich context for a file: summary, symbols, imports, related files |
| `get_batch_summaries` | Compact summaries for up to 20 files in one call |
| `find_symbol` | Locate class/function/interface definitions by name |
| `find_callers` | Trace call chains via BFS through the call graph |
| `get_dependencies` | Module-level dependency relationships |
| `get_file_summary` | Quick overview of a single file |
| `search_architecture` | Query human-authored architecture docs |
| `health_check` | Knowledge base status and freshness |

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
| HuggingFace (default for build) | `huggingface` | Optional `HF_API_TOKEN` |
| Local server | `local` / `codesage` | Python embedding server running |
| Ollama | `ollama` | Local Ollama instance |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Mock (CI) | `mock` | None — returns zero vectors |

See [.env.example](.env.example) for all environment variables.

## Project structure

```
scripts/                  # Knowledge build pipeline
  build-knowledge.ts      # Full build orchestrator
  watch.ts                # Incremental file watcher
  lib/                    # Extractors, summarizers, embeddings
src/
  types.ts                # Shared type definitions
mcp-server/
  server.ts               # MCP server entry point
  tools/                  # Tool implementations
test/                     # Unit, integration, and perf tests
.knowledge/               # Generated knowledge artifacts (gitignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run setup` | One-command setup (install, build knowledge, build MCP) |
| `pnpm run setup:full` | Setup + Python embedding server and vector indexes |
| `pnpm run build-knowledge` | Full knowledge base build |
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
