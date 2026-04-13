# Contributing to ai-code-knowledge

Thanks for your interest in contributing! This guide covers the development setup and workflow.

## Development setup

```bash
# Clone the repo
git clone https://github.com/amangcoder/ai-code-knowledge.git
cd ai-code-knowledge

# Install dependencies
pnpm install    # preferred
# or: npm install

# Build the knowledge base (uses static summarizer, no API keys needed)
pnpm run build-knowledge

# Build the MCP server
pnpm run build-mcp

# Run tests
pnpm test

# Type-check
pnpm run typecheck
```

## Project layout

- `scripts/` — Knowledge build pipeline (extractors, summarizers, embeddings)
- `src/` — Shared types and utilities
- `mcp-server/` — MCP server and tool implementations
- `test/` — Unit, integration, and performance tests

## Making changes

For bug fixes and small improvements, open a PR directly. For larger changes or new features, please open an issue first to discuss the approach.

1. Fork and create a branch from `master`
2. Make your changes
3. Run `pnpm run typecheck` and `pnpm test` to verify
4. Commit with a clear message describing the change
5. Open a pull request

### Type syncing

If you modify `src/types.ts`, run `npm run sync-types` to propagate the changes to `mcp-server/types.ts`. The MCP server has a separate `tsconfig.mcp.json` and cannot import from `src/` directly.

### Adding a new MCP tool

1. Create the tool handler in `mcp-server/tools/`
2. Register it in `mcp-server/server.ts`
3. Add tests in `test/`
4. Document the tool in `DOCUMENTATION.md`

### Testing

Tests use vitest. The CI runs on Node 18, 20, and 22.

```bash
pnpm test                                # All tests
pnpm vitest run test/some.test.ts        # Single file
pnpm vitest run --reporter=verbose       # Verbose output
```

No API keys are needed for tests — CI uses `SUMMARIZER_MODE=static` and `EMBEDDING_MODEL=mock`.

## Code style

- TypeScript strict mode
- ES modules (`"type": "module"`)
- Prefer small, focused functions
- Use the existing patterns in the codebase as reference

## License

By submitting a pull request, you agree that your contribution is licensed under the [MIT License](LICENSE).

## Reporting issues

Open an issue on GitHub with:
- What you expected vs what happened
- Steps to reproduce
- Node.js version and OS
