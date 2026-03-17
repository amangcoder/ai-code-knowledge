import { loadSymbols, loadIndex } from './lib/data-loader.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { toRelative, computeClosestMatches, resolveProjectRoot } from './lib/path-utils.js';
import { buildFooterSection } from './lib/metadata-footer.js';
/**
 * Ranks symbols in tiered order:
 * 1. Exact name match
 * 2. Prefix matches (name starts with query)
 * 3. Substring matches
 * Within each tier: exported before private, then alphabetically by name.
 */
function rankResults(results, query) {
    const queryLower = query.toLowerCase();
    function tier(entry) {
        const nameLower = entry.name.toLowerCase();
        if (nameLower === queryLower)
            return 0; // exact
        if (nameLower.startsWith(queryLower))
            return 1; // prefix
        return 2; // substring
    }
    return [...results].sort((a, b) => {
        const tierDiff = tier(a) - tier(b);
        if (tierDiff !== 0)
            return tierDiff;
        // Within tier: exported first, then alphabetical
        if (a.isExported !== b.isExported)
            return a.isExported ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
/**
 * Formats a single SymbolEntry into display lines.
 */
function formatSymbolEntry(sym, projectRoot, symbolMap) {
    const relFile = toRelative(sym.file, projectRoot);
    const qualifiedName = `${relFile}::${sym.name}`;
    const lines = [];
    lines.push(`Name:      ${sym.name}`);
    lines.push(`Qualified: ${qualifiedName}`);
    lines.push(`Type:      ${sym.type}`);
    lines.push(`File:      ${relFile}`);
    lines.push(`Line:      ${sym.line}`);
    lines.push(`Signature: ${sym.signature}`);
    if (sym.returnType) {
        lines.push(`Returns:   ${sym.returnType}`);
    }
    if (sym.isExported !== undefined) {
        lines.push(`Exported:  ${sym.isExported}`);
    }
    if (sym.isAsync)
        lines.push(`Async:     true`);
    if (sym.accessModifier)
        lines.push(`Access:    ${sym.accessModifier}`);
    if (sym.deprecationNotice)
        lines.push(`DEPRECATED: ${sym.deprecationNotice}`);
    // Full JSDoc — no truncation
    if (sym.jsdoc) {
        lines.push(`Doc:`);
        for (const docLine of sym.jsdoc.split('\n')) {
            lines.push(`  ${docLine}`);
        }
    }
    // Parameters
    if (sym.parameters && sym.parameters.length > 0) {
        lines.push(`Params:`);
        for (const p of sym.parameters) {
            let param = `  - ${p.name}: ${p.type}`;
            if (p.optional)
                param += ' (optional)';
            if (p.defaultValue)
                param += ` = ${p.defaultValue}`;
            if (p.description)
                param += ` — ${p.description}`;
            lines.push(`           ${param}`);
        }
    }
    // Caller/callee counts with top-3 callers
    const calledBy = sym.calledBy ?? [];
    const calls = sym.calls ?? [];
    lines.push(`Callers: ${calledBy.length}, Callees: ${calls.length}`);
    if (calledBy.length > 0) {
        const top3 = calledBy.slice(0, 3);
        for (const callerQN of top3) {
            const callerSym = symbolMap.get(callerQN);
            if (callerSym) {
                const callerRel = toRelative(callerSym.file, projectRoot);
                lines.push(`  ← ${callerQN} (${callerRel}:${callerSym.line})`);
            }
            else {
                lines.push(`  ← ${callerQN}`);
            }
        }
        if (calledBy.length > 3) {
            lines.push(`  ... and ${calledBy.length - 3} more callers`);
        }
    }
    if (sym.complexity != null) {
        lines.push(`Complexity: ${sym.complexity}`);
    }
    return lines;
}
/**
 * Handles the find_symbol MCP tool call.
 * Searches .knowledge/symbols.json for entries matching the provided name
 * (case-insensitive substring match). Optionally filters by symbol type and module.
 * Returns up to 50 results ranked by match quality.
 */
export function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    const index = loadIndex(knowledgeRoot);
    if (!index) {
        return {
            content: [{
                    type: 'text',
                    text: 'Knowledge base not found. The knowledge index has not been built yet for this project.',
                }],
            isError: true,
        };
    }
    const symbols = loadSymbols(knowledgeRoot);
    if (!symbols) {
        return {
            content: [{
                    type: 'text',
                    text: 'Symbol index not available. The knowledge base may need to be rebuilt.',
                }],
            isError: true,
        };
    }
    const nameLower = args.name.toLowerCase();
    const typeLower = args.type?.toLowerCase();
    const moduleLower = args.module?.toLowerCase();
    // Build symbolMap for caller lookups
    const symbolMap = new Map();
    for (const sym of symbols) {
        symbolMap.set(sym.qualifiedName, sym);
    }
    // Filter: case-insensitive substring match on name, optional type + module filters
    let results = symbols.filter((entry) => {
        const nameMatch = entry.name.toLowerCase().includes(nameLower);
        if (!nameMatch)
            return false;
        if (typeLower !== undefined && entry.type.toLowerCase() !== typeLower)
            return false;
        if (moduleLower !== undefined) {
            const relFile = toRelative(entry.file, projectRoot).toLowerCase();
            if (!relFile.startsWith(moduleLower))
                return false;
        }
        return true;
    });
    // Rank results with tiered system
    results = rankResults(results, args.name);
    // Check for zero results
    if (results.length === 0) {
        const typeHint = args.type ? ` with type "${args.type}"` : '';
        const moduleHint = args.module ? ` in module "${args.module}"` : '';
        // Check staleness (index older than 15 minutes)
        const indexAgeMs = Date.now() - new Date(index.lastBuilt).getTime();
        const isOldIndex = indexAgeMs > 15 * 60 * 1000;
        const allNames = symbols.map(s => s.name);
        const suggestions = computeClosestMatches(args.name, allNames, 3);
        const lines = [
            `No symbols found matching "${args.name}"${typeHint}${moduleHint}.`,
        ];
        if (isOldIndex) {
            lines.push('');
            lines.push(`⚠ Index staleness warning: the knowledge base was built ${Math.round(indexAgeMs / 60000)} minutes ago. Results may be incomplete if files have changed since then.`);
        }
        if (suggestions.length > 0) {
            lines.push('');
            lines.push(`Did you mean one of these?`);
            for (const s of suggestions) {
                lines.push(`  - ${s}`);
            }
            lines.push('');
            lines.push(`Tip: Use get_implementation_context(file="<path>") to explore a specific file's symbols.`);
        }
        else {
            lines.push('');
            lines.push(`Try: find_symbol(name="handler") for broader results, or get_module_context(module="tools") to see all symbols in a module.`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    // Limit to 50 results
    const limited = results.slice(0, 50);
    const total = results.length;
    const sections = [];
    // Header section
    const headerLines = [
        `Found ${limited.length}${total > 50 ? ` of ${total}` : ''} symbol(s) matching "${args.name}"${args.type ? ` (type: ${args.type})` : ''}${args.module ? ` (module: ${args.module})` : ''}:`,
    ];
    sections.push({ label: '', content: headerLines.join('\n'), priority: 0 });
    // Symbol entries — each as a separate section with increasing priority
    for (let i = 0; i < limited.length; i++) {
        const entry = limited[i];
        const entryLines = formatSymbolEntry(entry, projectRoot, symbolMap);
        sections.push({
            label: '',
            content: entryLines.join('\n'),
            priority: 1 + Math.floor(i / 10), // group of 10 per priority level
        });
    }
    // Truncation note
    if (total > 50) {
        sections.push({
            label: '',
            content: `${total - 50} items omitted — use module parameter or a more specific name to retrieve`,
            priority: 50,
        });
    }
    // Metadata footer
    sections.push(buildFooterSection(index, projectRoot));
    const budget = TOOL_BUDGETS['find_symbol'] ?? 14000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
