import * as fs from 'node:fs';
import * as path from 'node:path';
import { ARTIFACT_SCHEMAS, PHASE_ORDER, PHASE_TO_ARTIFACT, ARTIFACT_PATH_CONVENTION, getPriorPhases } from './lib/artifact-schemas.js';
import { buildResponse, TOOL_BUDGETS } from './lib/response-budget.js';
import { resolveProjectRoot, safePath } from './lib/path-utils.js';
/**
 * Resolves the workspace artifacts directory.
 * Uses WORKSPACE_ROOT env override if set, otherwise resolves from knowledgeRoot.
 */
function resolveArtifactsDir(knowledgeRoot) {
    const workspaceRoot = process.env['WORKSPACE_ROOT'];
    if (workspaceRoot) {
        return path.join(workspaceRoot, 'artifacts');
    }
    const projectRoot = resolveProjectRoot(knowledgeRoot);
    return path.join(projectRoot, 'workspace', 'artifacts');
}
/**
 * Reads an artifact JSON file and extracts a content preview.
 * Returns null if the file does not exist or cannot be parsed.
 */
function readArtifactPreview(artifactType, artifactsDir) {
    const artifactPath = path.join(artifactsDir, `${artifactType}.json`);
    // Security: validate path containment
    const safe = safePath(artifactPath, artifactsDir);
    if (!safe) {
        return { exists: false };
    }
    let raw;
    try {
        raw = fs.readFileSync(artifactPath, 'utf8');
    }
    catch {
        return { exists: false };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { exists: false };
    }
    // Extract 5-10 top-level key-value pairs as preview
    const entries = Object.entries(parsed).slice(0, 10);
    const previewLines = [];
    for (const [k, v] of entries) {
        let valStr;
        if (v === null) {
            valStr = 'null';
        }
        else if (typeof v === 'string') {
            valStr = v.length > 120 ? v.slice(0, 117) + '...' : v;
        }
        else if (typeof v === 'number' || typeof v === 'boolean') {
            valStr = String(v);
        }
        else if (Array.isArray(v)) {
            if (v.length === 0) {
                valStr = '[]';
            }
            else if (v.length <= 3) {
                const items = v.map(item => typeof item === 'string' ? item.slice(0, 60) : JSON.stringify(item).slice(0, 60));
                valStr = `[${items.join(', ')}]`;
            }
            else {
                const first = typeof v[0] === 'string' ? v[0].slice(0, 60) : JSON.stringify(v[0]).slice(0, 60);
                valStr = `[${first}, ... +${v.length - 1} more]`;
            }
        }
        else if (typeof v === 'object') {
            const subKeys = Object.keys(v).slice(0, 5);
            valStr = `{${subKeys.join(', ')}}`;
        }
        else {
            valStr = JSON.stringify(v).slice(0, 120);
        }
        previewLines.push(`  ${k}: ${valStr}`);
    }
    return { exists: true, preview: previewLines.join('\n') };
}
export function handler(args, knowledgeRoot = '.knowledge') {
    if (!PHASE_ORDER.includes(args.phase)) {
        return {
            content: [{
                    type: 'text',
                    text: [
                        `Unknown phase: "${args.phase}"`,
                        '',
                        'Valid phases:',
                        ...PHASE_ORDER.map((p) => `  - ${p}`),
                    ].join('\n'),
                }],
            isError: true,
        };
    }
    const priorPhases = getPriorPhases(args.phase);
    if (priorPhases.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: 'No prior phases — this is the first phase in the pipeline.',
                }],
        };
    }
    const artifactsDir = resolveArtifactsDir(knowledgeRoot);
    const sections = [];
    // Summary header
    const artifactTypes = priorPhases.map((p) => PHASE_TO_ARTIFACT[p]);
    sections.push({
        label: '',
        content: [
            `=== Cumulative Context for: ${args.phase} ===`,
            `Prior phases: ${priorPhases.length}`,
            `Expected artifacts: ${artifactTypes.join(', ')}`,
            `Artifacts directory: ${artifactsDir}`,
        ].join('\n'),
        priority: 0,
    });
    // Build sections for each prior phase
    for (let i = 0; i < priorPhases.length; i++) {
        const phase = priorPhases[i];
        const artifactType = PHASE_TO_ARTIFACT[phase];
        const schema = ARTIFACT_SCHEMAS[artifactType];
        const result = readArtifactPreview(artifactType, artifactsDir);
        if (result.exists) {
            const storePath = ARTIFACT_PATH_CONVENTION.replace('{type}', artifactType);
            sections.push({
                label: `${phase} → ${artifactType} [FOUND]`,
                content: [
                    `Path: ${storePath}`,
                    `Content preview:`,
                    result.preview,
                ].join('\n'),
                priority: i + 1,
            });
        }
        else {
            // Missing artifact — BLOCKING warning
            const storePath = ARTIFACT_PATH_CONVENTION.replace('{type}', artifactType);
            const notes = schema?.notes?.length > 200 ? schema.notes.slice(0, 200) : (schema?.notes ?? '');
            sections.push({
                label: `${phase} → ${artifactType} [MISSING ⚠ BLOCKING]`,
                content: [
                    `artifact_exists: false`,
                    `⚠ BLOCKING: This artifact is required for ${args.phase} but was not found at: ${storePath}`,
                    `Required keys: ${schema?.requiredKeys?.join(', ') ?? 'see schema'}`,
                    notes ? `Notes: ${notes}` : '',
                ].filter(Boolean).join('\n'),
                priority: i + 1,
            });
        }
    }
    // Schema reference section (secondary)
    const schemaLines = [];
    for (const artifactType of artifactTypes) {
        const schema = ARTIFACT_SCHEMAS[artifactType];
        if (schema) {
            schemaLines.push(`  ${artifactType}: required keys = ${schema.requiredKeys.join(', ')}`);
        }
    }
    if (schemaLines.length > 0) {
        sections.push({
            label: 'Schema Reference',
            content: schemaLines.join('\n'),
            priority: priorPhases.length + 2,
        });
    }
    const budget = TOOL_BUDGETS['get_cumulative_context'] ?? 24000;
    return {
        content: [{ type: 'text', text: buildResponse(sections, budget) }],
    };
}
