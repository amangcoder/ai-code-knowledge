/**
 * MCP Server entry point for the AI Code Knowledge System.
 *
 * Registers all knowledge tools and communicates exclusively via stdio.
 * All errors and logs go to stderr — stdout is reserved for MCP protocol messages.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as findSymbol from './tools/find-symbol.js';
import * as findCallers from './tools/find-callers.js';
import * as getDependencies from './tools/get-dependencies.js';
import * as getFileSummary from './tools/get-file-summary.js';
import * as searchArchitecture from './tools/search-architecture.js';
import * as healthCheck from './tools/health-check.js';
import * as getProjectOverview from './tools/get-project-overview.js';
import * as getBatchSummaries from './tools/get-batch-summaries.js';
import * as getModuleContext from './tools/get-module-context.js';
import * as getImplementationContext from './tools/get-implementation-context.js';
const KNOWLEDGE_ROOT = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge';
async function main() {
    const server = new McpServer({
        name: 'ai-code-knowledge',
        version: '0.2.0',
    });
    // ── Composite tools (use these first) ─────────────────────────────────
    server.tool('get_project_overview', 'Get a complete project overview in a single call: file tree, tech stack, modules, ' +
        'symbol counts, and key entry points. Use this as your FIRST call on any project.', {
        depth: z
            .number()
            .int()
            .min(1)
            .max(4)
            .optional()
            .describe('File tree depth (default: 2, max: 4)'),
    }, async (args) => {
        return getProjectOverview.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_module_context', 'Get everything about a module in one call: file summaries, exported symbols, ' +
        'internal dependencies, shared patterns, and the module\'s role in the architecture.', {
        module: z.string().describe('Module name (e.g., "src", "scripts", "mcp-server")'),
    }, async (args) => {
        return getModuleContext.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_implementation_context', 'Get rich context for a file: summary, all symbols with signatures, related files, ' +
        'import/export relationships, and code pattern fingerprint. Use before modifying a file.', {
        file: z
            .string()
            .describe('Relative file path (e.g., "src/lib/foo.ts")'),
        includePatterns: z
            .boolean()
            .optional()
            .describe('Include code patterns and related files (default: true)'),
    }, async (args) => {
        return getImplementationContext.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_batch_summaries', 'Get summaries for multiple files in a single call. Returns compact one-line summaries. ' +
        'Use when you know which files you need context for.', {
        files: z
            .array(z.string())
            .min(1)
            .max(20)
            .describe('Array of relative file paths (max 20)'),
    }, async (args) => {
        return getBatchSummaries.handler(args, KNOWLEDGE_ROOT);
    });
    // ── Targeted query tools ──────────────────────────────────────────────
    server.tool('find_symbol', 'Search the knowledge base for symbols (functions, classes, interfaces) by name. ' +
        'Uses case-insensitive substring matching. Optionally filter by symbol type.', {
        name: z.string().describe('Symbol name or substring to search for'),
        type: z
            .string()
            .optional()
            .describe('Optional symbol type filter (e.g. "function", "class", "interface")'),
    }, async (args) => {
        return await findSymbol.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('find_callers', 'Find all callers of a given symbol using BFS traversal of the call graph. ' +
        'Returns file and line information for each caller.', {
        symbol: z
            .string()
            .describe('Fully-qualified symbol name to find callers for'),
        maxDepth: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Maximum BFS traversal depth (default: 1)'),
    }, async (args) => {
        return findCallers.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_dependencies', 'Return direct and transitive module dependencies from the dependency graph. ' +
        'Lists available modules when the requested module is not found.', {
        module: z.string().describe('Module name to look up dependencies for'),
        depth: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('BFS traversal depth (default: 1)'),
    }, async (args) => {
        return getDependencies.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_file_summary', 'Retrieve the AI-generated summary for a single source file. ' +
        'Prefer get_batch_summaries for multiple files or get_implementation_context for richer detail.', {
        file: z
            .string()
            .describe('Relative file path (e.g. "src/lib/foo.ts" or just "foo.ts")'),
    }, async (args) => {
        return getFileSummary.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('search_architecture', 'Search the architecture documentation for relevant content. ' +
        'Returns matching lines with ±3 lines of context.', {
        query: z
            .string()
            .describe('Case-insensitive search query to match against architecture.md'),
    }, async (args) => {
        return await searchArchitecture.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('health_check', 'Check the status of the knowledge base. ' +
        'Returns lastBuilt timestamp, file count, available modules. ' +
        'Use verbose=true for tech stack and file tree.', {
        verbose: z
            .boolean()
            .optional()
            .describe('Include tech stack, project type, and file tree (default: false)'),
    }, async (args) => {
        return await healthCheck.handler(args, KNOWLEDGE_ROOT);
    });
    // Connect via stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[mcp-server] Knowledge MCP server started\n');
}
main().catch((err) => {
    process.stderr.write(`[mcp-server] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
