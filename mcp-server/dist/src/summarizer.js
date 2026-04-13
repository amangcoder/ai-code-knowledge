/**
 * Summarizer module for AI Code Knowledge System.
 *
 * Generates LLM-quality descriptions for source files.
 * Supports multiple modes:
 *   - static:      Rule-based, no external calls. Minimal richness.
 *   - anthropic:   Uses Anthropic Claude API via @anthropic-ai/sdk.
 *   - claude-code: Uses claude CLI or API to generate descriptions.
 */
const DEFAULT_CONFIG = {
    mode: 'static',
    model: 'claude-3-haiku-20240307',
    apiKey: '',
    maxDescriptionLength: 300,
    timeoutMs: 10000,
};
/**
 * Infers architectural role from file path.
 */
export function inferArchitecturalRole(relPath) {
    const filename = relPath.split('/').pop() ?? '';
    if (filename === 'server.ts' || filename === 'index.ts' || filename === 'main.ts') {
        return 'entry-point';
    }
    if (relPath.includes('/lib/')) {
        return 'utility';
    }
    if (filename.startsWith('get-') ||
        filename.startsWith('find-') ||
        filename.startsWith('search-') ||
        filename.startsWith('health-') ||
        filename.startsWith('validate-')) {
        return 'handler';
    }
    if (filename.includes('.test.') || filename.includes('.spec.')) {
        return 'test';
    }
    return 'module';
}
/**
 * Generate a static (no LLM) file summary from code analysis.
 * Provides minimal richness but is reliable and fast.
 */
export function generateStaticDescription(relPath, symbols, imports) {
    const filename = relPath.split('/').pop() ?? relPath;
    const baseName = filename.replace(/\.[tj]sx?$/, '');
    const exportedSymbols = symbols.filter(s => s.isExported && s.type !== 'module-init');
    const role = inferArchitecturalRole(relPath);
    const parts = [];
    if (role === 'entry-point') {
        parts.push(`Entry point for the application.`);
    }
    else if (role === 'handler') {
        const toolName = baseName.replace(/-/g, '_');
        parts.push(`MCP tool handler implementing the ${toolName} tool.`);
    }
    else if (role === 'utility') {
        parts.push(`Utility library providing ${baseName} functionality.`);
    }
    else {
        parts.push(`${baseName} module.`);
    }
    if (exportedSymbols.length > 0) {
        const names = exportedSymbols.slice(0, 5).map(s => s.name);
        const rest = exportedSymbols.length > 5 ? ` and ${exportedSymbols.length - 5} more` : '';
        parts.push(`Exports: ${names.join(', ')}${rest}.`);
    }
    const externalImports = imports.filter(i => !i.startsWith('.'));
    if (externalImports.length > 0) {
        parts.push(`Uses: ${externalImports.slice(0, 3).join(', ')}.`);
    }
    return parts.join(' ');
}
/**
 * Attempts to generate an LLM-quality description using the Anthropic API.
 * Falls back to static description on any error.
 */
export async function generateLLMDescription(relPath, content, symbols, config = {}) {
    const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
    if (resolvedConfig.mode === 'static') {
        return generateStaticDescription(relPath, symbols, []);
    }
    // Truncate content for API call (first 3000 chars is enough context)
    const contentSnippet = content.length > 3000 ? content.slice(0, 3000) + '\n...' : content;
    const exportedNames = symbols.filter(s => s.isExported).map(s => s.name).join(', ');
    const prompt = `Analyze this source file and provide a 1-2 sentence description (100-200 chars) of its purpose.\n` +
        `File: ${relPath}\n` +
        `Exported symbols: ${exportedNames || '(none)'}\n\n` +
        `Code:\n\`\`\`\n${contentSnippet}\n\`\`\`\n\n` +
        `Respond with ONLY the description text, no preamble.`;
    try {
        if (resolvedConfig.mode === 'anthropic') {
            return await callAnthropicAPI(prompt, resolvedConfig);
        }
        else if (resolvedConfig.mode === 'claude-code') {
            return await callClaudeCode(prompt, resolvedConfig);
        }
    }
    catch (err) {
        process.stderr.write(`[summarizer] LLM call failed for ${relPath}: ${err.message}\n`);
    }
    // Fallback to static
    return generateStaticDescription(relPath, symbols, []);
}
/** Call Anthropic API using dynamic import (avoids hard dependency). */
async function callAnthropicAPI(prompt, config) {
    // Dynamic import to avoid requiring @anthropic-ai/sdk when not in use
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Anthropic;
    try {
        const mod = await import('@anthropic-ai/sdk');
        Anthropic = mod.default ?? mod.Anthropic;
    }
    catch {
        throw new Error('@anthropic-ai/sdk not installed. Install it or use mode="static".');
    }
    const apiKey = config.apiKey || process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not set');
    }
    const client = new Anthropic({ apiKey });
    const message = await Promise.race([
        client.messages.create({
            model: config.model,
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), config.timeoutMs)),
    ]);
    const text = message.content[0]?.text ?? '';
    return text.slice(0, config.maxDescriptionLength);
}
/** Call claude CLI for description generation. */
async function callClaudeCode(prompt, config) {
    const { execFileSync } = await import('node:child_process');
    try {
        const output = execFileSync('claude', ['--print', prompt], {
            timeout: config.timeoutMs,
            encoding: 'utf8',
        });
        return output.trim().slice(0, config.maxDescriptionLength);
    }
    catch {
        throw new Error('claude CLI not available or failed');
    }
}
/**
 * Enriches a FileSummary with LLM-generated description.
 * Returns the summary unchanged if LLM fails (graceful fallback).
 */
export async function enrichSummaryWithLLM(summary, content, symbols, config = {}) {
    const description = await generateLLMDescription(summary.file, content, symbols, config);
    // Only set llmDescription if it's ≥100 chars (requirement REQ-002)
    if (description.length >= 100) {
        return { ...summary, llmDescription: description };
    }
    return summary;
}
/**
 * Scan for test files associated with a source file.
 * Looks for files matching <basename>.test.ts, <basename>.spec.ts in same and adjacent directories.
 */
export function findTestFiles(relPath, allFiles) {
    const baseName = relPath.replace(/\.[tj]sx?$/, '');
    const patterns = [
        baseName + '.test.ts',
        baseName + '.test.tsx',
        baseName + '.spec.ts',
        baseName + '.spec.tsx',
        baseName.replace(/\/([^/]+)$/, '/__tests__/$1.test.ts'),
        baseName.replace(/\/([^/]+)$/, '/tests/$1.test.ts'),
    ];
    return allFiles.filter(f => patterns.some(p => f === p || f.endsWith('/' + p.split('/').pop())));
}
