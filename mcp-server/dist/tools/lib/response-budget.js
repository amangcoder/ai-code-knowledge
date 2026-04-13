/**
 * Response budget manager for MCP tool responses.
 * Manages per-tool configurable byte-ceiling responses with section-level truncation.
 * Default: 12,000 bytes. Hard cap: 32,000 bytes.
 */
export const DEFAULT_BUDGET = 12000;
export const HARD_CAP = 32000;
/**
 * Per-tool byte budget overrides. Tools with richer output get higher budgets.
 */
export const TOOL_BUDGETS = {
    get_implementation_context: 20000,
    get_project_overview: 16000,
    get_cumulative_context: 24000,
    get_module_context: 14000,
    find_symbol: 14000,
    find_callers: 14000,
    get_batch_summaries: 14000,
    health_check: 14000,
    get_code_patterns: 14000,
    search_architecture: 14000,
    semantic_search: 14000,
};
/**
 * Builds a response string from sections, respecting the byte budget.
 * Sections are sorted by priority (lower = more important).
 * If budget is exceeded, whole sections are dropped starting from lowest priority.
 * Never cuts mid-sentence — drops entire sections with a truncation marker.
 *
 * @param sections Array of sections to include
 * @param toolBudget Optional per-tool budget override (defaults to DEFAULT_BUDGET)
 * @returns Formatted response string within budget
 */
export function buildResponse(sections, toolBudget) {
    // Determine effective budget
    let budget = toolBudget ?? DEFAULT_BUDGET;
    if (budget > HARD_CAP) {
        process.stderr.write(`[response-budget] WARNING: requested budget ${budget} exceeds hard cap ${HARD_CAP}, clamping\n`);
        budget = HARD_CAP;
    }
    // Sort by priority ascending (lower priority number = higher importance)
    const sorted = [...sections].sort((a, b) => a.priority - b.priority);
    const included = [];
    const omitted = [];
    let totalBytes = 0;
    for (const section of sorted) {
        const block = formatSectionBlock(section);
        const blockBytes = Buffer.byteLength(block, 'utf8');
        // +2 for the '\n\n' separator between sections
        const needed = totalBytes === 0 ? blockBytes : blockBytes + 2;
        if (totalBytes + needed <= budget) {
            included.push(section);
            totalBytes += needed;
        }
        else {
            omitted.push(section);
        }
    }
    const parts = included.map(formatSectionBlock);
    if (omitted.length > 0) {
        // Emit section-level truncation marker
        const omittedLabels = omitted
            .filter(s => s.label && s.priority < 99) // skip footer label
            .map(s => s.label);
        if (omittedLabels.length > 0) {
            const marker = `[${omittedLabels.length} section(s) omitted: ${omittedLabels.join(', ')} — use a more specific query or increase depth]`;
            parts.push(marker);
        }
    }
    return parts.join('\n\n');
}
function formatSectionBlock(section) {
    if (!section.label) {
        return section.content;
    }
    return `${section.label}:\n${section.content}`;
}
