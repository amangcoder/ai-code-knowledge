/**
 * MCP Server entry point for the AI Code Knowledge System.
 *
 * Registers all 6 knowledge tools and communicates exclusively via stdio.
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
const KNOWLEDGE_ROOT = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge';
async function main() {
    const server = new McpServer({
        name: 'ai-code-knowledge',
        version: '0.1.0',
    });
    // ── find_symbol ──────────────────────────────────────────────────────────
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
    // ── find_callers ─────────────────────────────────────────────────────────
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
    // ── get_dependencies ─────────────────────────────────────────────────────
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
    // ── get_file_summary ─────────────────────────────────────────────────────
    server.tool('get_file_summary', 'Retrieve the AI-generated summary for a source file. ' +
        'Normalizes paths automatically and supports partial suffix matching.', {
        file: z
            .string()
            .describe('Relative file path (e.g. "src/lib/foo.ts" or just "foo.ts")'),
    }, async (args) => {
        return getFileSummary.handler(args, KNOWLEDGE_ROOT);
    });
    // ── search_architecture ──────────────────────────────────────────────────
    server.tool('search_architecture', 'Search the architecture documentation for relevant content. ' +
        'Returns matching lines with ±3 lines of context.', {
        query: z
            .string()
            .describe('Case-insensitive search query to match against architecture.md'),
    }, async (args) => {
        return await searchArchitecture.handler(args, KNOWLEDGE_ROOT);
    });
    // ── health_check ─────────────────────────────────────────────────────────
    server.tool('health_check', 'Check the status of the knowledge base. ' +
        'Returns lastBuilt timestamp, file count, available modules, and artifact flags.', {}, async (args) => {
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
