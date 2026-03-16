import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { KnowledgeIndex } from '../types.js';

export interface CallToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

/**
 * Handles the health_check MCP tool call.
 * Reads .knowledge/index.json and returns a formatted status string showing:
 * lastBuilt, fileCount, hasSymbols, hasDependencies, and module list.
 * Returns a build instruction message if index.json is missing.
 */
export async function handler(
    _args: Record<string, unknown>,
    knowledgeRoot: string = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge'
): Promise<CallToolResult> {
    const indexPath = path.join(knowledgeRoot, 'index.json');

    let index: KnowledgeIndex;
    try {
        const raw = await fs.readFile(indexPath, 'utf8');
        index = JSON.parse(raw) as KnowledgeIndex;
    } catch {
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        'Knowledge base not found.',
                        '',
                        'Please run the following command to build it first:',
                        '',
                        '  npm run build-knowledge',
                        '',
                        'Once the build completes, run health_check again to see the status.',
                    ].join('\n'),
                },
            ],
        };
    }

    const hasSymbols = index.hasSymbols ? 'yes' : 'no';
    const hasDependencies = index.hasDependencies ? 'yes' : 'no';
    const moduleList =
        index.modules.length > 0
            ? index.modules.map((m) => `  - ${m}`).join('\n')
            : '  (none)';

    const statusText = [
        '=== Knowledge Base Status ===',
        '',
        `Last Built:       ${index.lastBuilt}`,
        `File Count:       ${index.fileCount}`,
        `Has Symbols:      ${hasSymbols}`,
        `Has Dependencies: ${hasDependencies}`,
        '',
        'Modules:',
        moduleList,
    ].join('\n');

    return {
        content: [
            {
                type: 'text',
                text: statusText,
            },
        ],
    };
}
