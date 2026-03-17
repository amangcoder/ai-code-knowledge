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
import * as getArtifactSchema from './tools/get-artifact-schema.js';
import * as getDirectoryTree from './tools/get-directory-tree.js';
import * as getArtifactStorePath from './tools/get-artifact-store-path.js';
import * as getCodePatterns from './tools/get-code-patterns.js';
import * as findTemplateFile from './tools/find-template-file.js';
import * as getStaticDataSchema from './tools/get-static-data-schema.js';
import * as validateArtifactDraft from './tools/validate-artifact-draft.js';
import * as getCumulativeContext from './tools/get-cumulative-context.js';
const KNOWLEDGE_ROOT = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge';
async function main() {
    const server = new McpServer({
        name: 'ai-code-knowledge',
        version: '0.2.0',
    });
    // ── Composite tools (use these first) ─────────────────────────────────
    server.tool('get_project_overview', 'Get a complete project overview in a single call: file tree, tech stack, modules, symbol counts, ' +
        'and key entry points. Use this as your FIRST call on any project. ' +
        'Returns module dependency table, circular dependency warnings, file purposes, and tech stack. ' +
        'Alternative: get_module_context for a single module, get_implementation_context for a single file. ' +
        'Param depth: integer 1-4, controls file tree depth (default: 2).', {
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
    server.tool('get_module_context', 'Get everything about a module in one call: file summaries with architectural roles, exported symbols ' +
        'with full signatures and return types, internal dependencies, shared patterns, and the module\'s ' +
        'role in the architecture. Use when you need to understand a whole directory/module. ' +
        'Alternative: get_project_overview for all modules, get_implementation_context for a single file. ' +
        'Param module: module name — NOT a file path (e.g., "tools", "src", "lib"). ' +
        'Example: get_module_context(module="tools")', {
        module: z.string().describe('Module name — NOT a file path (e.g., "tools", "src", "mcp-server")'),
    }, async (args) => {
        return getModuleContext.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_implementation_context', 'Get rich context for a single file before modifying it: purpose, all symbols with full signatures, ' +
        'code snippets, caller/callee counts, related files, import/export relationships, and code patterns. ' +
        'Use BEFORE modifying any file. Returns code snippets for top exported functions. ' +
        'Alternative: get_batch_summaries for multiple files, get_module_context for all files in a module. ' +
        'Param file: relative path — NOT absolute (e.g., "tools/find-symbol.ts", NOT "/Users/.../find-symbol.ts"). ' +
        'Example: get_implementation_context(file="tools/lib/cache.ts")', {
        file: z
            .string()
            .describe('Relative file path — NOT absolute (e.g., "tools/lib/foo.ts")'),
        includePatterns: z
            .boolean()
            .optional()
            .describe('Include code patterns and related files (default: true)'),
    }, async (args) => {
        return getImplementationContext.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_batch_summaries', 'Get rich summaries for multiple files in a single call: description, richness level, architectural role, ' +
        'exported symbol names, and total symbol count. More efficient than multiple get_file_summary calls. ' +
        'Use when you need context for 2-20 specific files. ' +
        'Alternative: get_implementation_context for a single file with deeper detail. ' +
        'Param files: array of relative paths — NOT absolute. Example: ["tools/find-symbol.ts", "types.ts"]', {
        files: z
            .array(z.string())
            .min(1)
            .max(20)
            .describe('Array of relative file paths — NOT absolute (max 20)'),
    }, async (args) => {
        return getBatchSummaries.handler(args, KNOWLEDGE_ROOT);
    });
    // ── Targeted query tools ──────────────────────────────────────────────
    server.tool('find_symbol', 'Search for functions, classes, interfaces, and types by name. Uses case-insensitive substring matching. ' +
        'Returns qualified name (file::symbolName), line number, full signature, return type, JSDoc, ' +
        'caller/callee counts with top-3 caller names and relative paths. Results ranked: exact > prefix > substring. ' +
        'When 0 results: suggests similar names and shows staleness warning if index is old. ' +
        'Alternative: get_implementation_context for all symbols in a specific file. ' +
        'Param name: symbol name or substring — e.g., "handler", "load", "buildResponse". ' +
        'Param type: optional filter — "function", "class", "interface", "type", "method". ' +
        'Param module: optional directory prefix to scope results — e.g., "tools/lib" or "tools". ' +
        'Example: find_symbol(name="handler", module="tools")', {
        name: z
            .string()
            .max(200)
            .describe('Symbol name or substring to search for (max 200 chars)'),
        type: z
            .string()
            .optional()
            .describe('Optional symbol type filter: "function", "class", "interface", "type", "method"'),
        module: z
            .string()
            .optional()
            .describe('Optional module/directory prefix to scope results (e.g., "tools/lib", "tools")'),
    }, async (args) => {
        return findSymbol.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('find_callers', 'Find all symbols that call a given function/method using BFS traversal of the call graph. ' +
        'Returns file path, line number, and depth for each caller. Supports direction=callees to find ' +
        'what a symbol calls instead. Disambiguates when multiple symbols share a name. ' +
        'Use "relativePath::symbolName" format to resolve ambiguity unambiguously. ' +
        'Alternative: find_symbol to locate the symbol first, get_implementation_context for full context. ' +
        'Param symbol: simple name (may show disambiguation list) or "path::name" format. ' +
        'Example: find_callers(symbol="tools/lib/cache.ts::getOrLoad") ' +
        'Example: find_callers(symbol="handler", direction="callees")', {
        symbol: z
            .string()
            .max(500)
            .describe('Symbol name or "relativePath::symbolName" for unambiguous selection. ' +
            'Example: "getOrLoad" or "tools/lib/cache.ts::getOrLoad"'),
        maxDepth: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe('Maximum BFS traversal depth (default: 1, max: 10)'),
        direction: z
            .enum(['callers', 'callees'])
            .optional()
            .describe('"callers" (default): who calls this symbol. "callees": what this symbol calls.'),
    }, async (args) => {
        return findCallers.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_dependencies', 'Return direct and transitive module-level dependencies from the dependency graph. ' +
        'Shows what modules a given module imports from, at configurable depth. ' +
        'Lists available modules with closest-match suggestions when the requested module is not found. ' +
        'Alternative: get_module_context for file-level dependencies within a module. ' +
        'Param module: module name — e.g., "tools", "src". ' +
        'Example: get_dependencies(module="tools", depth=2)', {
        module: z.string().describe('Module name to look up dependencies for (e.g., "tools", "src")'),
        depth: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('BFS traversal depth (default: 1)'),
    }, async (args) => {
        return getDependencies.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_file_summary', 'Retrieve the AI-generated summary for a single source file: purpose, exports, dependencies, ' +
        'public API, test files. Use for a quick overview of one file. ' +
        'On miss: returns top-3 closest matching file paths and suggests alternatives. ' +
        'Prefer get_batch_summaries for multiple files or get_implementation_context for richer detail. ' +
        'Param file: relative path — NOT absolute (e.g., "tools/find-symbol.ts"). ' +
        'Example: get_file_summary(file="tools/lib/cache.ts")', {
        file: z
            .string()
            .describe('Relative file path — NOT absolute (e.g., "tools/lib/foo.ts" or just "cache.ts")'),
    }, async (args) => {
        return getFileSummary.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('search_architecture', 'Search across three sources: (1) architecture.md documentation, (2) file summaries ' +
        '(llmDescription/detailedPurpose fields), and (3) symbol JSDoc comments. ' +
        'Each result labeled with its source type. Safe string search — no regex. ' +
        'Use for semantic queries about how the system works. ' +
        'Alternative: find_symbol for finding a specific function, get_module_context for module structure. ' +
        'Param query: search term (case-insensitive). Example: search_architecture(query="cache invalidation")', {
        query: z
            .string()
            .max(200)
            .describe('Case-insensitive search query (max 200 chars). Example: "cache invalidation"'),
    }, async (args) => {
        return searchArchitecture.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('health_check', 'Check the health and readiness of the knowledge base. ' +
        'Returns: readiness score (0-100), coverage gaps (files not indexed), stale files ' +
        '(modified after last build), index errors, per-module file counts, and last build timestamp. ' +
        'Use to verify the knowledge base is current before relying on other tools. ' +
        'verbose=true adds tech stack and file tree. ' +
        'If readiness < 70, prefer direct file reading tools for accuracy.', {
        verbose: z
            .boolean()
            .optional()
            .describe('Include tech stack, project type, and file tree (default: false)'),
    }, async (args) => {
        return healthCheck.handler(args, KNOWLEDGE_ROOT);
    });
    // ── Pipeline & workspace tools ───────────────────────────────────────
    server.tool('get_artifact_schema', 'Returns the expected JSON schema for a pipeline artifact type: required keys, key types, ' +
        'example structure, and notes. Call BEFORE generating any artifact to ensure correct format. ' +
        'Valid types: prd, architecture, engineering_plan, tasks, review. ' +
        'Example: get_artifact_schema(artifact_type="tasks")', {
        artifact_type: z
            .string()
            .describe('Artifact type name (e.g., "prd", "architecture", "tasks", "review")'),
    }, async (args) => {
        return getArtifactSchema.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_directory_tree', 'Returns the current file/folder structure as a tree listing. ' +
        'Use to understand project layout or verify directory structure before creating files. ' +
        'Alternative: get_project_overview includes a file tree along with richer context. ' +
        'Param path: relative path from project root — NOT absolute (default: project root). ' +
        'Example: get_directory_tree(path="tools", depth=2)', {
        path: z
            .string()
            .optional()
            .describe('Relative path from project root — NOT absolute (default: root)'),
        depth: z
            .number()
            .int()
            .min(1)
            .max(5)
            .optional()
            .describe('Tree depth (default: 3, max: 5)'),
    }, async (args) => {
        return getDirectoryTree.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_artifact_store_path', 'Returns the expected filesystem path where a pipeline artifact should be written. ' +
        'Use to determine where to save output before writing files. ' +
        'Example: get_artifact_store_path(artifact_type="tasks")', {
        artifact_type: z
            .string()
            .describe('Artifact type name (e.g., "prd", "architecture", "tasks")'),
    }, async (args) => {
        return getArtifactStorePath.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_code_patterns', 'Extracts recurring code patterns with occurrence counts and annotated examples: ' +
        'structural (async/sync, class/functional, handler pattern), component, CSS, data, routing, testing. ' +
        'Also detects dominant styling mechanism and data access pattern. ' +
        'Use to understand code conventions before adding new files. ' +
        'Param pattern_type: optional filter — "component", "css", "data", "routing", "testing". ' +
        'Omit for all patterns including structural analysis.', {
        pattern_type: z
            .string()
            .optional()
            .describe('Pattern category: "component", "css", "data", "routing", "testing" (omit for all)'),
    }, async (args) => {
        return getCodePatterns.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('find_template_file', 'Given a description, finds the most similar existing files to use as templates for new code. ' +
        'Helps maintain consistency with existing patterns. ' +
        'Param description: plain English description of what you need. ' +
        'Example: find_template_file(description="MCP tool handler that searches by name")', {
        description: z
            .string()
            .describe('Description of what you need (e.g., "MCP tool handler", "data file for blog posts")'),
    }, async (args) => {
        return findTemplateFile.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_static_data_schema', 'Returns the structure of static data files: keys, exports, and relationships between data files. ' +
        'Use before reading or modifying static/config data files.', {}, async () => {
        return getStaticDataSchema.handler({}, KNOWLEDGE_ROOT);
    });
    server.tool('validate_artifact_draft', 'Pre-validates artifact JSON against the expected schema before final submission. ' +
        'Catches format errors, missing required keys, and wrong types. ' +
        'Call this BEFORE writing any artifact to disk. ' +
        'Param json_content: the full JSON string of your artifact draft. ' +
        'Example: validate_artifact_draft(artifact_type="tasks", json_content="{...}")', {
        artifact_type: z
            .string()
            .describe('Artifact type to validate against (e.g., "prd", "tasks", "architecture")'),
        json_content: z
            .string()
            .max(512000)
            .describe('JSON string to validate (max 512KB)'),
    }, async (args) => {
        return validateArtifactDraft.handler(args, KNOWLEDGE_ROOT);
    });
    server.tool('get_cumulative_context', 'Returns a digest of all artifact types produced by prior pipeline phases, including content previews. ' +
        'Found artifacts show content_preview with key-value pairs. Missing artifacts show BLOCKING warning. ' +
        'Use at the START of any pipeline phase to understand what upstream phases produced. ' +
        'Param phase: the current phase name — context from ALL prior phases is returned. ' +
        'Example: get_cumulative_context(phase="backend_engineer")', {
        phase: z
            .string()
            .describe('Current pipeline phase name (e.g., "architecture", "engineering_plan", "backend_engineer", "qa")'),
    }, async (args) => {
        return getCumulativeContext.handler(args, KNOWLEDGE_ROOT);
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
