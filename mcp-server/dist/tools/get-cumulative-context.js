import { ARTIFACT_SCHEMAS, PHASE_ORDER, PHASE_TO_ARTIFACT, ARTIFACT_PATH_CONVENTION, getPriorPhases } from './lib/artifact-schemas.js';
import { buildResponse } from './lib/response-budget.js';
export function handler(args, knowledgeRoot = '.knowledge') {
    if (!PHASE_ORDER.includes(args.phase)) {
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        `Unknown phase: "${args.phase}"`,
                        '',
                        'Valid phases:',
                        ...PHASE_ORDER.map((p) => `  - ${p}`),
                    ].join('\n'),
                },
            ],
            isError: true,
        };
    }
    const priorPhases = getPriorPhases(args.phase);
    if (priorPhases.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No prior phases — this is the first phase in the pipeline.',
                },
            ],
        };
    }
    const sections = [];
    // Summary section at the top with highest priority
    const artifactTypes = priorPhases.map((p) => PHASE_TO_ARTIFACT[p]);
    sections.push({
        label: '',
        content: [
            `=== Cumulative Context for: ${args.phase} ===`,
            `Prior phases: ${priorPhases.length}`,
            `Expected artifacts: ${artifactTypes.join(', ')}`,
        ].join('\n'),
        priority: 0,
    });
    // Build sections for each prior phase
    for (let i = 0; i < priorPhases.length; i++) {
        const phase = priorPhases[i];
        const artifactType = PHASE_TO_ARTIFACT[phase];
        const schema = ARTIFACT_SCHEMAS[artifactType];
        const storePath = ARTIFACT_PATH_CONVENTION.replace('{type}', artifactType);
        const notes = schema.notes.length > 200 ? schema.notes.slice(0, 200) : schema.notes;
        sections.push({
            label: `${phase} → ${artifactType}`,
            content: [
                `Artifact: ${artifactType}.json`,
                `Path: ${storePath}`,
                `Required keys: ${schema.requiredKeys.join(', ')}`,
                `Notes: ${notes}`,
            ].join('\n'),
            priority: i + 1,
        });
    }
    const text = buildResponse(sections);
    return {
        content: [{ type: 'text', text }],
    };
}
