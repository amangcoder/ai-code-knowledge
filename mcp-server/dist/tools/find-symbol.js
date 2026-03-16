import * as fs from 'node:fs/promises';
import * as path from 'node:path';
/**
 * Handles the find_symbol MCP tool call.
 * Searches .knowledge/symbols.json for entries matching the provided name
 * (case-insensitive substring match). Optionally filters by symbol type.
 * Returns up to 20 results sorted by name length ascending.
 */
export async function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    const symbolsPath = path.join(knowledgeRoot, 'symbols.json');
    let symbols;
    try {
        const raw = await fs.readFile(symbolsPath, 'utf8');
        symbols = JSON.parse(raw);
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Knowledge base not found at "${symbolsPath}".\n` +
                            `Please run "npm run build-knowledge" first to generate the knowledge artifacts.`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Error reading symbols: ${err.message ?? err}`,
                },
            ],
            isError: true,
        };
    }
    const nameLower = args.name.toLowerCase();
    const typeLower = args.type?.toLowerCase();
    // Filter: case-insensitive substring match on name, optional type filter
    let results = symbols.filter((entry) => {
        const nameMatch = entry.name.toLowerCase().includes(nameLower);
        if (!nameMatch)
            return false;
        if (typeLower !== undefined) {
            return entry.type.toLowerCase() === typeLower;
        }
        return true;
    });
    // Sort by name length ascending (shorter/more exact matches first)
    results.sort((a, b) => a.name.length - b.name.length);
    // Limit to 20 results
    const limited = results.slice(0, 20);
    const total = results.length;
    if (limited.length === 0) {
        const typeHint = args.type ? ` with type "${args.type}"` : '';
        return {
            content: [
                {
                    type: 'text',
                    text: `No symbols found matching "${args.name}"${typeHint}.\n` +
                        `Try a broader search term or omit the type filter.`,
                },
            ],
        };
    }
    const lines = [];
    lines.push(`Found ${limited.length}${total > 20 ? ` of ${total}` : ''} symbol(s) matching "${args.name}"${args.type ? ` (type: ${args.type})` : ''}:\n`);
    for (const entry of limited) {
        lines.push(`Name:      ${entry.name}`);
        lines.push(`Type:      ${entry.type}`);
        lines.push(`File:      ${entry.file}`);
        lines.push(`Line:      ${entry.line}`);
        lines.push(`Signature: ${entry.signature}`);
        if (entry.qualifiedName !== entry.name) {
            lines.push(`Qualified: ${entry.qualifiedName}`);
        }
        lines.push('');
    }
    if (total > 20) {
        lines.push(`(Showing first 20 of ${total} results. Refine your search for more specific results.)`);
    }
    return {
        content: [
            {
                type: 'text',
                text: lines.join('\n'),
            },
        ],
    };
}
