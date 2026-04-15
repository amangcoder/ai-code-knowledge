# CLAUDE.md — AI Agent Instructions

## Overview
This repository uses an **AI Code Knowledge System** to provide a structured index of the codebase. All extracted knowledge is stored in the `.knowledge/` directory, which includes symbol graphs, dependency maps, and LLM-generated file summaries. This system is designed to reduce token overhead and provide high-level architectural insights without requiring agents to scan every file.

## MCP Tools Available

### Composite Tools (use these first — they reduce tool calls by 60-70%)
- `get_project_overview(depth?)`: **Start here.** Returns file tree, tech stack, modules, symbol counts, and key entry points in a single call. Eliminates the need for `ls`, `health_check`, or path-guessing.
- `get_module_context(module)`: Get everything about a module: file summaries, exported symbols, internal dependencies, shared patterns, and role in the architecture. Replaces multiple `get_file_summary` calls.
- `get_implementation_context(file, includePatterns?)`: Rich context for a single file: summary, all symbols with signatures, related files, import/export graph, and code pattern fingerprint. Use before modifying a file.
- `get_batch_summaries(files[])`: Get compact summaries for up to 20 files in one call. Use when you know which files you need.

### Targeted Query Tools
- `find_symbol(name, type?)`: Locate class, function, or interface definitions across the project.
- `find_callers(symbol, maxDepth?)`: Identify all symbols that call a specific function or class method.
- `get_dependencies(module, depth?)`: Retrieve module-level or file-level dependency relationships.
- `get_file_summary(file)`: Get a high-level overview of a single file. Prefer `get_implementation_context` for richer detail.
- `search_architecture(query)`: Query the human-authored architecture documentation for system-wide patterns.
- `semantic_search(query, scope?, topK?)`: Hybrid BM25 + vector search across files, symbols, and features. Use for natural-language queries like "authentication flow" or "how does caching work".
- `explore_graph(start, edgeTypes?, maxDepth?, direction?)`: Traverse the knowledge graph following typed edges (calls, imports, depends_on, etc.). Use to trace call chains or import relationships.
- `get_feature_context(query, topK?)`: Look up cross-cutting feature groups by semantic similarity (e.g. "payment processing", "user auth").
- `health_check(verbose?)`: Knowledge base status. Use `verbose=true` for tech stack and file tree.

### Build Management
- `rebuild_knowledge(incremental?, skip_vectors?, skip_features?, skip_graphify?, rebuild_features?, richness?, timeout_minutes?)`: Trigger a knowledge base rebuild without leaving the agent. Use after large refactors or when `health_check` reports staleness. Defaults to an incremental build with a 10-minute timeout. Returns status, duration, build stats, and log output.

## Preferred Tool Order
Follow this order to minimize tool calls and maximize context efficiency:
1. `get_project_overview` (first call — understand the project structure)
2. `get_module_context` (understand a specific area of the codebase)
3. `get_implementation_context` (understand a specific file before modifying it)
4. `get_batch_summaries` (when you know which files you need context for)
5. `find_symbol` (to locate specific logic by name)
6. `find_callers` (to understand impact or usage patterns)
7. `get_dependencies` (to understand module relationships)
8. `get_file_summary` (single file, lightweight — prefer `get_implementation_context`)
9. `search_architecture` (to understand high-level system design)
10. `semantic_search` (natural-language queries when other tools don't return results)
11. `explore_graph` (trace call/import chains across modules)
12. `rebuild_knowledge` (when knowledge is stale after significant changes)
13. `native grep` (only as a last resort if MCP tools fail to find a pattern)

## When to Use Each Tool

### `get_project_overview`
**Always call this first** when working with a new or unfamiliar project. It gives you the file tree, tech stack, module structure, and entry points — everything you need to start navigating without any `ls` commands.
*Example: "What does this project look like?"*

### `get_module_context`
Use when you need to understand an entire module before diving into specific files. Returns all file summaries, exported symbols, and internal structure in one call.
*Example: "What's in the `scripts` module?"*

### `get_implementation_context`
Use before modifying a file. Gives you everything: the file's purpose, all its symbols, which files import it, siblings in the same directory, and a pattern fingerprint so you can write consistent code.
*Example: "I need to modify `src/services/auth.ts` — what should I know?"*

### `get_batch_summaries`
Use when you've identified multiple files and need a quick overview of all of them at once.
*Example: "Summarize these 5 files for me"*

### `find_symbol`
Use when you know the name of a class, function, or interface but don't know where it is defined.
*Example: "Where is the `AuthService` class defined?"*

### `find_callers`
Use to trace how a specific symbol is used or to find where a function is invoked. Critical for impact analysis.
*Example: "Which components call the `deleteUser` method?"*

### `get_dependencies`
Use to understand the relationship between different parts of the system. Helps identify entry points and shared utilities.
*Example: "What are the dependencies of the `orders` module?"*

### `get_file_summary`
Use for a quick, lightweight summary of a single file. For richer context, prefer `get_implementation_context`.
*Example: "What does `src/services/logger.ts` do?"*

### `search_architecture`
Use for high-level questions about the system's design or to find which modules handle specific responsibilities.
*Example: "How is authentication handled in this project?"*

## DO NOT
- **Do not** use `ls` to explore directories — use `get_project_overview` instead.
- **Do not** call `get_file_summary` in a loop — use `get_batch_summaries` or `get_module_context`.
- **Do not** read full file contents before checking `get_implementation_context` or `get_file_summary`.
- **Do not** assume the directory structure is the only source of truth; use `get_dependencies`.
- **Do not** skip using MCP tools when unsure about where a feature is implemented.

## Knowledge Freshness
The knowledge index is updated automatically if the `watch` script is running. If you suspect the index is stale (e.g., after a large refactor), trigger a rebuild using the `rebuild_knowledge` MCP tool — no terminal needed. For a full rebuild including vectors, call `rebuild_knowledge(incremental=false)`. Always check `.knowledge/index.json` for the `lastBuilt` timestamp if in doubt.
