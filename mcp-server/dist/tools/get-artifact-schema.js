import { ARTIFACT_SCHEMAS, getArtifactTypes } from './lib/artifact-schemas.js';
export function handler(args, knowledgeRoot = '.knowledge') {
    const schema = ARTIFACT_SCHEMAS[args.artifact_type];
    if (!schema) {
        const available = getArtifactTypes();
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        `Unknown artifact type: "${args.artifact_type}"`,
                        '',
                        'Available artifact types:',
                        ...available.map((t) => `  - ${t}`),
                    ].join('\n'),
                },
            ],
            isError: true,
        };
    }
    const lines = [];
    lines.push(`=== Artifact Schema: ${args.artifact_type} ===`);
    lines.push('');
    lines.push('Required Keys:');
    for (const key of schema.requiredKeys) {
        const keyType = schema.keyTypes[key] ?? 'unknown';
        lines.push(`  - ${key}: ${keyType}`);
    }
    lines.push('');
    lines.push('Example Structure:');
    lines.push(JSON.stringify(schema.exampleStructure, null, 2));
    lines.push('');
    lines.push('Important Notes:');
    lines.push(schema.notes);
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
    };
}
