import { loadIndex } from './lib/data-loader.js';
import { buildFileTree } from './lib/file-tree.js';
import { detectTechStack, classifyProjectType } from './lib/tech-stack.js';
import { resolveProjectRoot } from './lib/path-utils.js';
export async function handler(args, knowledgeRoot = process.env['KNOWLEDGE_ROOT'] ?? '.knowledge') {
    const index = loadIndex(knowledgeRoot);
    if (!index) {
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
    const moduleList = index.modules.length > 0
        ? index.modules.map((m) => `  - ${m}`).join('\n')
        : '  (none)';
    const lines = [
        '=== Knowledge Base Status ===',
        '',
        `Last Built:       ${index.lastBuilt}`,
        `File Count:       ${index.fileCount}`,
        `Has Symbols:      ${hasSymbols}`,
        `Has Dependencies: ${hasDependencies}`,
        '',
        'Modules:',
        moduleList,
    ];
    if (args.verbose) {
        const projectRoot = resolveProjectRoot(knowledgeRoot);
        const techStack = detectTechStack(projectRoot);
        const projectType = classifyProjectType(projectRoot);
        lines.push('');
        lines.push(`Project Type: ${projectType}`);
        lines.push(`Languages: ${techStack.languages.join(', ') || '(unknown)'}`);
        lines.push(`Frameworks: ${techStack.frameworks.join(', ') || '(none)'}`);
        lines.push(`Build Tools: ${techStack.buildTools.join(', ') || '(none)'}`);
        lines.push(`Package Manager: ${techStack.packageManager ?? '(unknown)'}`);
        const tree = buildFileTree(projectRoot, 2);
        if (tree) {
            lines.push('');
            lines.push('File Tree (depth 2):');
            lines.push(tree);
        }
    }
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
    };
}
