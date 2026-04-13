# ai-code-knowledge

Extract structured knowledge from codebases and expose it to AI agents via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

AI coding agents typically scan entire repositories to understand code — burning tokens and time. This tool builds a persistent knowledge base (symbols, call graphs, dependency maps, file summaries) that agents can query through MCP tools instead.

**Result:** 70-90% reduction in token usage and repo scanning for AI agents.

## How it works

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

## Quick start

```bash
# Install
npm install

# Build the knowledge base
npm run build-knowledge

# Build and start the MCP server
npm run build-mcp
npm run start-mcp
```

### Connect to Claude Code

Add to your `.claude/mcp_servers.json`:

```json
{
  "servers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["mcp-server/dist/server.js"]
    }
  }
}
```

### Keep knowledge up to date

```bash
# Watch mode — rebuilds incrementally on file changes
npm run watch

# Or install a pre-commit hook
npm run install-hooks
```

## MCP tools

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

## Summarizer backends

Control how file summaries are generated with `SUMMARIZER_MODE`:

| Mode | API required | Description |
|------|-------------|-------------|
| `static` (default) | None | Derives summaries from code structure alone |
| `ollama` | Local Ollama | Uses a local LLM (default: `qwen2.5-coder:7b`) |
| `anthropic` | `ANTHROPIC_API_KEY` | Uses Claude for high-quality summaries |

## Embedding providers

Vector search is powered by configurable embedding backends via `EMBEDDING_MODEL`:

| Provider | Value | Requirements |
|----------|-------|-------------|
| HuggingFace (default for build) | `huggingface` | Optional `HF_API_TOKEN` |
| Local server | `local` / `codesage` | Python embedding server running |
| Ollama | `ollama` | Local Ollama instance |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Mock (CI) | `mock` | None — returns zero vectors |

See [.env.example](.env.example) for all configuration options.

## Build scripts

| Command | Description |
|---------|-------------|
| `npm run build-knowledge` | Full knowledge base build |
| `npm run build-knowledge:incremental` | Only reprocess changed files |
| `npm run build-knowledge:skip-vectors` | Skip vector index generation |
| `npm run build-mcp` | Compile the MCP server |
| `npm run start-mcp` | Start the MCP server |
| `npm run watch` | Incremental rebuilds on file changes |
| `npm run test` | Run the test suite |
| `npm run typecheck` | Type-check the full project |

## Requirements

- Node.js 18+
- npm or pnpm

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

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — Comprehensive technical reference
- [CLAUDE.md](CLAUDE.md) — Instructions for AI agents using this system
- [PRD.md](PRD.md) — Product requirements document

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
