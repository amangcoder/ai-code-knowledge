# CLAUDE.md — AI Agent Instructions

## Overview
This repository uses an **AI Code Knowledge System** to provide a structured index of the codebase. All extracted knowledge is stored in the `.knowledge/` directory, which includes symbol graphs, dependency maps, and LLM-generated file summaries. This system is designed to reduce token overhead and provide high-level architectural insights without requiring agents to scan every file.

## MCP Tools Available
- `find_symbol`: Locate class, function, or interface definitions across the project.
- `find_callers`: Identify all symbols that call a specific function or class method.
- `get_dependencies`: Retrieve module-level or file-level dependency relationships.
- `get_file_summary`: Get a high-level overview of a file's purpose and its exports.
- `search_architecture`: Query the human-authored architecture documentation for system-wide patterns.

## Preferred Tool Order
Follow this order for exploration to minimize token usage and maximize context efficiency:
1. `find_symbol` (to locate specific logic)
2. `find_callers` (to understand impact or usage patterns)
3. `get_dependencies` (to understand module relationships)
4. `get_file_summary` (to understand a specific file before reading code)
5. `search_architecture` (to understand high-level system design)
6. `native grep` (only as a last resort if MCP tools fail to find a pattern)

## When to Use Each Tool

### `find_symbol`
Use this tool when you know the name of a class, function, or interface but don't know where it is defined. 
*Example: "Where is the `AuthService` class defined?"*

### `find_callers`
Use this tool to trace how a specific symbol is used or to find where a function is invoked. This is critical for impact analysis.
*Example: "Which components call the `deleteUser` method?"*

### `get_dependencies`
Use this tool to understand the relationship between different parts of the system. It helps identify entry points and shared utilities.
*Example: "What are the dependencies of the `orders` module?"*

### `get_file_summary`
Use this tool before opening a file to understand its purpose, side effects, and what it exports. This prevents reading irrelevant code.
*Example: "What does `src/services/logger.ts` do?"*

### `search_architecture`
Use this tool for high-level questions about the system's design or to find which modules handle specific responsibilities.
*Example: "How is authentication handled in this project?"*

## DO NOT
- **Do not** scan the entire `/src` or `/scripts` directory using native file listing if you can use MCP tools.
- **Do not** read full file contents before checking `get_file_summary`.
- **Do not** assume the directory structure is the only source of truth; use `get_dependencies`.
- **Do not** skip using MCP tools when unsure about where a feature is implemented.

## Knowledge Freshness
The knowledge index is updated automatically if the `watch` script is running. If you suspect the index is stale (e.g., after a large refactor), you can trigger a manual rebuild using `npm run build-knowledge`. Always check `.knowledge/index.json` for the `lastBuilt` timestamp if in doubt.
