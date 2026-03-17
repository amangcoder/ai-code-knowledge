import * as path from 'node:path';
import { buildFileTree } from './lib/file-tree.js';
import { resolveProjectRoot } from './lib/path-utils.js';
export function handler(args, knowledgeRoot = '.knowledge') {
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    let resolvedPath = projectRoot;
    let displayPath = '/';
    if (args.path) {
        resolvedPath = path.join(projectRoot, args.path);
        displayPath = args.path;
        // Path traversal protection
        if (!resolvedPath.startsWith(projectRoot)) {
            return {
                content: [{ type: 'text', text: 'Error: path traversal is not allowed.' }],
                isError: true,
            };
        }
    }
    const depth = Math.min(args.depth ?? 3, 5);
    const tree = buildFileTree(resolvedPath, depth);
    if (!tree) {
        return {
            content: [{ type: 'text', text: 'No files found at path.' }],
            isError: true,
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: `=== Directory Tree: ${displayPath} (depth ${depth}) ===\n${tree}`,
            },
        ],
    };
}
