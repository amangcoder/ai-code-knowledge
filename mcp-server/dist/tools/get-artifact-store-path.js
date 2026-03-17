import { ARTIFACT_SCHEMAS, ARTIFACT_PATH_CONVENTION, getArtifactTypes } from './lib/artifact-schemas.js';
export function handler(args, knowledgeRoot = '.knowledge') {
    const artifactType = args.artifact_type;
    if (!ARTIFACT_SCHEMAS[artifactType]) {
        const available = getArtifactTypes()
            .map((t) => `  - ${t}`)
            .join('\n');
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        `Unknown artifact type: "${artifactType}"`,
                        '',
                        'Available artifact types:',
                        available,
                    ].join('\n'),
                },
            ],
            isError: true,
        };
    }
    const storePath = ARTIFACT_PATH_CONVENTION.replace('{type}', artifactType);
    const available = getArtifactTypes()
        .map((t) => `  - ${t}`)
        .join('\n');
    return {
        content: [
            {
                type: 'text',
                text: [
                    `=== Artifact Store Path: ${artifactType} ===`,
                    '',
                    `Path: ${storePath}`,
                    `Convention: ${ARTIFACT_PATH_CONVENTION}`,
                    'Note: This is a relative path from the project root. The orchestrator resolves the absolute path.',
                    '',
                    'Available artifact types:',
                    available,
                ].join('\n'),
            },
        ],
    };
}
