/**
 * MCP Server entry point for the AI Code Knowledge System.
 *
 * Registers all knowledge tools and communicates exclusively via stdio.
 * All errors and logs go to stderr — stdout is reserved for MCP protocol messages.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initToolLogger, withToolLogging } from './tools/lib/tool-logger.js';
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
import * as semanticSearch from './tools/semantic-search.js';
import * as exploreGraph from './tools/explore-graph.js';
import * as getFeatureContext from './tools/get-feature-context.js';
const KNOWLEDGE_ROOT = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge';
async function main() {
    const server = new McpServer({
        name: 'ai-code-knowledge',
        version: '0.4.0',
    });
    initToolLogger(KNOWLEDGE_ROOT);
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
        return withToolLogging('get_project_overview', args, () => getProjectOverview.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('get_module_context', 'Get everything about a module in one call: file summaries with architectural roles, exported symbols ' +
        'with full signatures and return types, internal dependencies, shared patterns, and the module\'s ' +
        'role in the architecture. Use when you need to understand a whole directory/module. ' +
        'Alternative: get_project_overview for all modules, get_implementation_context for a single file. ' +
        'Param module: module name — NOT a file path (e.g., "tools", "src", "lib"). ' +
        'Example: get_module_context(module="tools")', {
        module: z.string().describe('Module name — NOT a file path (e.g., "tools", "src", "mcp-server")'),
    }, async (args) => {
        return withToolLogging('get_module_context', args, () => getModuleContext.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_implementation_context', args, () => getImplementationContext.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_batch_summaries', args, () => getBatchSummaries.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('find_symbol', args, () => findSymbol.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('find_callers', args, () => findCallers.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_dependencies', args, () => getDependencies.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_file_summary', args, () => getFileSummary.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('search_architecture', args, () => searchArchitecture.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('health_check', args, () => healthCheck.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_artifact_schema', args, () => getArtifactSchema.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_directory_tree', args, () => getDirectoryTree.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('get_artifact_store_path', 'Returns the expected filesystem path where a pipeline artifact should be written. ' +
        'Use to determine where to save output before writing files. ' +
        'Example: get_artifact_store_path(artifact_type="tasks")', {
        artifact_type: z
            .string()
            .describe('Artifact type name (e.g., "prd", "architecture", "tasks")'),
    }, async (args) => {
        return withToolLogging('get_artifact_store_path', args, () => getArtifactStorePath.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_code_patterns', args, () => getCodePatterns.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('find_template_file', 'Given a description, finds the most similar existing files to use as templates for new code. ' +
        'Helps maintain consistency with existing patterns. ' +
        'Param description: plain English description of what you need. ' +
        'Example: find_template_file(description="MCP tool handler that searches by name")', {
        description: z
            .string()
            .describe('Description of what you need (e.g., "MCP tool handler", "data file for blog posts")'),
    }, async (args) => {
        return withToolLogging('find_template_file', args, () => findTemplateFile.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('get_static_data_schema', 'Returns the structure of static data files: keys, exports, and relationships between data files. ' +
        'Use before reading or modifying static/config data files.', {}, async () => {
        return withToolLogging('get_static_data_schema', {}, () => getStaticDataSchema.handler({}, KNOWLEDGE_ROOT));
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
        return withToolLogging('validate_artifact_draft', args, () => validateArtifactDraft.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('semantic_search', 'Search the codebase semantically using hybrid BM25 keyword + ANN vector retrieval merged via ' +
        'Reciprocal Rank Fusion. Returns ranked results with relevance scores, snippets, and metadata. ' +
        'Requires the vector index to be built first (npm run build-knowledge). ' +
        'Param query: natural-language search query (e.g., "authentication flow", "createOrder"). ' +
        'Param scope: filter results — "files" | "symbols" | "features" | "all" (default: "all"). ' +
        'Param topK: number of results to return (default: 10, max: 50). ' +
        'Example: semantic_search(query="how does caching work", scope="symbols", topK=5)', {
        query: z
            .string()
            .max(500)
            .describe('Natural-language search query (max 500 chars). Example: "authentication flow"'),
        scope: z
            .enum(['files', 'symbols', 'features', 'all'])
            .optional()
            .describe('Filter results by type: "files", "symbols", "features", or "all" (default: "all")'),
        topK: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe('Number of results to return (default: 10, max: 50)'),
    }, async (args) => {
        return withToolLogging('semantic_search', args, () => semanticSearch.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('explore_graph', 'Traverse the knowledge graph starting from a node, following typed edges up to a given depth. ' +
        'Returns depth-annotated nodes and traversed edges. ' +
        'Node types: file, symbol, module, feature, package. ' +
        'Edge types: contains, calls, imports, depends_on, implements, similar_to. ' +
        'Requires the graph to be built (Phase 8) or symbols/dependencies to exist for dynamic construction. ' +
        'Param start: node ID or name to start from. ' +
        '  Formats: "file:<path>", "symbol:<qualifiedName>", "module:<name>", or plain name/path. ' +
        '  Examples: "file:tools/lib/cache.ts", "symbol:handler", "tools", "cache.ts". ' +
        'Param edgeTypes: array of edge types to follow (default: all types). ' +
        '  Values: "contains", "calls", "imports", "depends_on", "implements", "similar_to". ' +
        'Param maxDepth: BFS depth limit 1–5 (default: 2). ' +
        'Param direction: "outgoing" (default) | "incoming" | "both". ' +
        'Example: explore_graph(start="symbol:handler", edgeTypes=["calls"], maxDepth=3, direction="outgoing")', {
        start: z
            .string()
            .max(500)
            .describe('Node ID or name to start traversal from. ' +
            'Accepts node IDs like "file:tools/lib/cache.ts" or plain names/paths. ' +
            'Example: "file:tools/lib/cache.ts", "symbol:handler", "module:tools"'),
        edgeTypes: z
            .array(z.enum([
            'contains',
            'calls',
            'imports',
            'depends_on',
            'implements',
            'similar_to',
        ]))
            .optional()
            .describe('Edge types to follow during traversal (default: all). ' +
            'Values: "contains", "calls", "imports", "depends_on", "implements", "similar_to"'),
        maxDepth: z
            .number()
            .int()
            .min(1)
            .max(5)
            .optional()
            .describe('BFS traversal depth limit 1–5 (default: 2)'),
        direction: z
            .enum(['outgoing', 'incoming', 'both'])
            .optional()
            .describe('"outgoing" (default): follow edges source→target. ' +
            '"incoming": follow edges target→source. ' +
            '"both": follow both directions.'),
    }, async (args) => {
        return withToolLogging('explore_graph', args, () => exploreGraph.handler(args, KNOWLEDGE_ROOT));
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
        return withToolLogging('get_cumulative_context', args, () => getCumulativeContext.handler(args, KNOWLEDGE_ROOT));
    });
    server.tool('get_feature_context', 'Look up cross-cutting feature groups discovered from the codebase by semantic similarity. ' +
        'Returns full feature summaries: name, description, files, entry points, data flow, ' +
        'key symbols, and related features. ' +
        'Requires feature discovery to be run (Phase 9 of build-knowledge). ' +
        'Gracefully degrades to keyword matching when the vector index is unavailable. ' +
        'Param query: natural-language description of the feature or cross-cutting concern ' +
        '  (e.g., "payment processing", "user authentication", "caching strategy"). ' +
        'Param topK: number of feature groups to return (default: 3, max: 20). ' +
        'Example: get_feature_context(query="payment processing", topK=3)', {
        query: z
            .string()
            .max(500)
            .describe('Natural-language query describing the feature or cross-cutting concern ' +
            '(max 500 chars). Example: "payment processing"'),
        topK: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('Number of feature groups to return (default: 3, max: 20)'),
    }, async (args) => {
        return withToolLogging('get_feature_context', args, () => getFeatureContext.handler(args, KNOWLEDGE_ROOT));
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
