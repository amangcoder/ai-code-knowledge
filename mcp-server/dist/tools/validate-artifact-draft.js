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
    let parsed;
    try {
        parsed = JSON.parse(args.json_content);
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: `JSON parse error: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
    const errors = [];
    // 4a. Check all requiredKeys are present
    const missingKeys = schema.requiredKeys.filter((key) => !(key in parsed));
    if (missingKeys.length > 0) {
        errors.push(`Missing required key(s): ${missingKeys.join(', ')}`);
    }
    // 4b. Type-check present keys
    for (const [key, expectedType] of Object.entries(schema.keyTypes)) {
        if (!(key in parsed))
            continue;
        const value = parsed[key];
        if (expectedType === 'string' || expectedType.startsWith('string')) {
            if (expectedType === 'string[]') {
                if (!Array.isArray(value)) {
                    errors.push(`Key "${key}" should be an array, got ${typeof value}`);
                }
            }
            else if (typeof value !== 'string') {
                errors.push(`Key "${key}" should be a string, got ${typeof value}`);
            }
        }
        else if (expectedType.startsWith('Array') || expectedType === 'string[]') {
            if (!Array.isArray(value)) {
                errors.push(`Key "${key}" should be an array, got ${typeof value}`);
            }
        }
        else if (expectedType === 'number' || expectedType.startsWith('number')) {
            if (typeof value !== 'number') {
                errors.push(`Key "${key}" should be a number, got ${typeof value}`);
            }
        }
        else if (expectedType === 'object' || expectedType.startsWith('object')) {
            if (typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`Key "${key}" should be an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
            }
        }
    }
    // 4c. Special validation for architecture: directory_structure
    if (args.artifact_type === 'architecture' && 'directory_structure' in parsed) {
        const ds = parsed['directory_structure'];
        if (!Array.isArray(ds)) {
            errors.push('architecture.directory_structure must be an array of strings, not a nested object');
        }
        else if (!ds.every((item) => typeof item === 'string')) {
            errors.push('architecture.directory_structure must be a flat array of path strings — nested objects are not allowed');
        }
    }
    // 4d. Special validation for review: verdict
    if (args.artifact_type === 'review' && 'verdict' in parsed) {
        const validVerdicts = ['pass', 'fail', 'pass_with_warnings'];
        if (!validVerdicts.includes(parsed['verdict'])) {
            errors.push(`review.verdict must be one of: ${validVerdicts.join(', ')} — got "${parsed['verdict']}"`);
        }
    }
    // 6. Check for unexpected top-level keys
    const warnings = [];
    const knownKeys = new Set(schema.requiredKeys);
    for (const key of Object.keys(parsed)) {
        if (!knownKeys.has(key)) {
            warnings.push(`Unexpected top-level key: "${key}"`);
        }
    }
    // 7. Format output
    const lines = [];
    if (errors.length === 0) {
        lines.push(`VALID - Artifact draft passes schema validation for '${args.artifact_type}'.`);
        lines.push('');
        lines.push(schema.notes);
    }
    else {
        lines.push(`INVALID - ${errors.length} validation error(s) found:`);
        for (let i = 0; i < errors.length; i++) {
            lines.push(`  ${i + 1}. ${errors[i]}`);
        }
        lines.push('');
        lines.push(`Schema notes: ${schema.notes}`);
    }
    if (warnings.length > 0) {
        lines.push('');
        lines.push('Warnings:');
        for (const w of warnings) {
            lines.push(`  - ${w}`);
        }
    }
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
    };
}
