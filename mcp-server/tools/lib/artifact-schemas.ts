import type { ArtifactSchema } from '../../types.js';

/**
 * Hardcoded artifact schemas derived from observed pipeline artifacts.
 * These are authoritative — agents use them for pre-flight format awareness.
 */
export const ARTIFACT_SCHEMAS: Record<string, ArtifactSchema> = {
    prd: {
        requiredKeys: ['title', 'overview', 'goals', 'requirements', 'constraints', 'acceptance_criteria'],
        keyTypes: {
            title: 'string',
            overview: 'string',
            goals: 'string[]',
            requirements: 'Array<{id, description, priority}>',
            constraints: 'string[]',
            acceptance_criteria: 'Array<{id, criteria}>',
        },
        exampleStructure: {
            title: 'Project Title — Feature Description',
            overview: 'One-paragraph summary of the product and its purpose...',
            goals: ['Goal 1: ...', 'Goal 2: ...'],
            requirements: [
                { id: 'REQ-001', description: 'Description of requirement', priority: 'must' },
            ],
            constraints: ['Frontend only — no backend changes'],
            acceptance_criteria: [
                { id: 'AC-001', criteria: 'When X happens, Y should result' },
            ],
        },
        notes: 'Requirements use priority values: "must", "should", "could". Each requirement needs a unique REQ-NNN id.',
    },

    architecture: {
        requiredKeys: ['components', 'data_flow', 'tech_decisions', 'constraints', 'directory_structure'],
        keyTypes: {
            components: 'Array<{name, responsibility, interfaces[], dependencies[]}>',
            data_flow: 'Array<{from, to, data, trigger}>',
            tech_decisions: 'Array<{decision, rationale, alternatives_considered[]}>',
            constraints: 'string[]',
            directory_structure: 'string[]',
        },
        exampleStructure: {
            components: [
                {
                    name: 'ThemeProvider',
                    responsibility: 'Owns dark/light mode state...',
                    interfaces: ['const { theme, toggleTheme } = useTheme()'],
                    dependencies: [],
                },
            ],
            data_flow: [
                { from: 'ContentProvider', to: 'Page Components', data: 'static content', trigger: 'useContent() hook' },
            ],
            tech_decisions: [
                { decision: 'Pure CSS variables for theming', rationale: 'Zero runtime cost...', alternatives_considered: ['CSS-in-JS', 'Tailwind'] },
            ],
            constraints: ['No backend modifications permitted'],
            directory_structure: [
                'src/pages/Home.jsx',
                'src/pages/Services.jsx',
                'src/components/Header.jsx',
                'src/content/static-data.js',
            ],
        },
        notes: 'CRITICAL: directory_structure MUST be a flat array of path strings like ' +
            '[\'src/pages/Home.jsx\', \'src/components/Header.jsx\']. ' +
            'Do NOT use nested objects or tree structures. Each entry is a plain relative path string.',
    },

    engineering_plan: {
        requiredKeys: ['strategy', 'implementation_order', 'risk_areas', 'testing_strategy'],
        keyTypes: {
            strategy: 'string',
            implementation_order: 'Array<{phase, description, tasks[], dependencies[]}>',
            risk_areas: 'Array<{area, risk, mitigation}>',
            testing_strategy: 'object with unit, integration, e2e, manual sections',
        },
        exampleStructure: {
            strategy: 'Phased implementation starting with infrastructure...',
            implementation_order: [
                { phase: 'Phase 0', description: 'Infrastructure & config', tasks: ['TASK-001'], dependencies: [] },
            ],
            risk_areas: [
                { area: 'Dark mode', risk: 'FOUC on page load', mitigation: 'Inline blocking script in <head>' },
            ],
            testing_strategy: {
                unit: 'Vitest for component logic',
                integration: 'React Testing Library for page rendering',
                e2e: 'Manual browser testing',
                manual: 'Cross-browser dark/light mode verification',
            },
        },
        notes: 'implementation_order phases should reference TASK-NNN ids from the tasks artifact.',
    },

    tasks: {
        requiredKeys: ['tasks'],
        keyTypes: {
            tasks: 'Array<{task_id, title, description, assigned_role, dependencies[], acceptance_criteria[], files_to_modify[], estimated_complexity}>',
        },
        exampleStructure: {
            tasks: [
                {
                    task_id: 'TASK-001',
                    title: 'Short descriptive title',
                    description: 'Detailed description of what to implement...',
                    assigned_role: 'frontend_engineer',
                    dependencies: [],
                    acceptance_criteria: ['Criterion 1', 'Criterion 2'],
                    files_to_modify: ['src/pages/Home.jsx', 'src/content/static-data.js'],
                    estimated_complexity: 'low',
                },
            ],
        },
        notes: 'task_id format: TASK-NNN (zero-padded 3 digits). assigned_role values: frontend_engineer, devops_engineer, designer. estimated_complexity: low, medium, high.',
    },

    competitor_research: {
        requiredKeys: ['competitors', 'summary'],
        keyTypes: {
            competitors: 'Array<{name, strengths[], weaknesses[], differentiators[]}>',
            summary: 'string (min 20 chars)',
            competitive_advantages: 'string[]',
            market_gaps: 'string[]',
        },
        exampleStructure: {
            competitors: [
                {
                    name: 'CompetitorX',
                    strengths: ['Strong brand', 'Large user base'],
                    weaknesses: ['Slow delivery', 'Poor UX'],
                    differentiators: ['AI-powered analytics'],
                },
            ],
            summary: 'The competitive landscape shows three direct competitors...',
            competitive_advantages: ['Faster time-to-market', 'Better developer experience'],
            market_gaps: ['No competitor offers real-time collaboration'],
        },
        notes: 'Only "competitors" and "summary" are required. competitive_advantages and market_gaps are optional.',
    },

    market_research: {
        requiredKeys: ['market_size', 'target_segments'],
        keyTypes: {
            market_size: 'object with tam, sam, som (each has value and basis)',
            target_segments: 'Array<{name, size, pain_intensity, willingness_to_pay, accessibility, fit_score, notes}>',
            approach: 'string',
            trends: 'Array<{trend, direction, strength, impact}>',
            timing_assessment: 'object with market_stage, readiness, enablers',
            risks: 'Array<{risk, severity, likelihood, mitigation}>',
            recommendations: 'string[]',
            sources: 'string',
        },
        exampleStructure: {
            market_size: {
                tam: { value: '$50B', basis: 'Global SaaS market' },
                sam: { value: '$5B', basis: 'Developer tools segment' },
                som: { value: '$500M', basis: 'AI-powered dev tools' },
            },
            target_segments: [
                { name: 'Enterprise CTOs', size: '50K+', pain_intensity: 'hair_on_fire', willingness_to_pay: '$50K/yr', accessibility: 'Medium', fit_score: 'high', notes: 'Primary buyer' },
            ],
            trends: [{ trend: 'AI-first development', direction: 'tailwind', strength: 'strong', impact: 'Core enabler' }],
            risks: [{ risk: 'Market saturation', severity: 'major', likelihood: 'medium', mitigation: 'Differentiate on UX' }],
            recommendations: ['Target enterprise segment first'],
            sources: 'Based on training knowledge, not live data',
        },
        notes: 'Only "market_size" and "target_segments" are required. pain_intensity: hair_on_fire, significant, moderate, nice_to_have. fit_score: high, medium, low.',
    },

    ux_spec: {
        requiredKeys: [
            'meta', 'design_system_reference', 'site_wide_enhancements', 'user_flows',
            'screens', 'interactions', 'responsive_breakpoints', 'accessibility_requirements',
            'data_architecture', 'component_hierarchy', 'seo_and_performance', 'testing_requirements',
        ],
        keyTypes: {
            meta: 'object with version, created, author, scope, based_on[], design_principles[]',
            design_system_reference: 'object with color tokens, typography, spacing',
            site_wide_enhancements: 'Array<{name, description, behavior}>',
            user_flows: 'Array<{name, steps[]}>',
            screens: 'Array<{name, route, sections[]}>',
            interactions: 'Array<{trigger, action, feedback}>',
            responsive_breakpoints: 'Array<{name, minWidth, layout}>',
            accessibility_requirements: 'Array<{requirement, wcag_level}>',
            data_architecture: 'object describing content data structure',
            component_hierarchy: 'object with component tree',
            seo_and_performance: 'object with meta, structured_data, performance targets',
            testing_requirements: 'Array<{area, tests[]}>',
        },
        exampleStructure: {
            meta: { version: '1.0', created: '2026-01-15', author: 'UX Agent', scope: 'Full website', based_on: ['prd', 'market_research'], design_principles: ['Mobile-first'] },
            design_system_reference: { primary: '#0D9488', background: '#F8FAFC' },
            site_wide_enhancements: [{ name: 'Dark mode toggle', description: 'Theme switcher', behavior: 'Persists to localStorage' }],
            user_flows: [{ name: 'Service discovery', steps: ['Land on home', 'Click services', 'View detail'] }],
            screens: [{ name: 'Home', route: '/', sections: ['hero', 'features', 'testimonials'] }],
            interactions: [{ trigger: 'scroll > 400px', action: 'Show back-to-top button', feedback: 'Fade in animation' }],
            responsive_breakpoints: [{ name: 'mobile', minWidth: 0, layout: 'single column' }],
            accessibility_requirements: [{ requirement: 'Color contrast >= 4.5:1', wcag_level: 'AA' }],
            data_architecture: {},
            component_hierarchy: {},
            seo_and_performance: { lcp_target: '< 2.5s' },
            testing_requirements: [{ area: 'Accessibility', tests: ['Screen reader navigation', 'Keyboard-only flow'] }],
        },
        notes: 'meta.based_on should list artifact types this spec was derived from. design_system_reference should use CSS variable names where possible.',
    },

    field_specialist_review: {
        requiredKeys: ['domain', 'summary'],
        keyTypes: {
            domain: 'string (the identified domain, e.g. "healthcare", "fintech")',
            summary: 'string (min 20 chars)',
            findings: 'Array<{area, assessment, severity, recommendation}>',
            compliance_notes: 'string[]',
            risks: 'string[]',
        },
        exampleStructure: {
            domain: 'healthcare',
            summary: 'This feature touches HIPAA-regulated patient data and requires specific safeguards...',
            findings: [
                { area: 'Data storage', assessment: 'Patient records stored without encryption at rest', severity: 'critical', recommendation: 'Enable AES-256 encryption for all PII columns' },
            ],
            compliance_notes: ['HIPAA requires BAA with all cloud providers handling PHI'],
            risks: ['Audit trail gaps for data access logging'],
        },
        notes: 'Only "domain" and "summary" are required. severity: critical, major, minor, nit.',
    },

    devops: {
        requiredKeys: ['agent', 'project', 'date', 'status', 'summary', 'verification'],
        keyTypes: {
            agent: 'string',
            project: 'string',
            date: 'string (ISO date)',
            status: 'string',
            summary: 'string',
            verification: 'object with checks performed',
        },
        exampleStructure: {
            agent: 'devops_engineer',
            project: 'layersiq-web',
            date: '2026-01-15',
            status: 'completed',
            summary: 'Configured deployment pipeline...',
            verification: { redirects: 'pass', headers: 'pass' },
        },
        notes: 'Additional optional keys: deployment_architecture, environment_variables, security_headers, caching_strategy, cicd_pipeline.',
    },

    review: {
        requiredKeys: ['verdict', 'summary'],
        keyTypes: {
            verdict: 'string ("pass" | "fail" | "pass_with_warnings" — also accepts "approve" | "reject" | "request_changes")',
            issues: 'Array<{severity, description, file?, line?, suggestion?}>',
            summary: 'string (min 20 chars)',
        },
        exampleStructure: {
            verdict: 'pass',
            issues: [
                { severity: 'minor', description: 'Missing alt text on image', file: 'src/pages/About.jsx', line: 42, suggestion: 'Add descriptive alt attribute' },
            ],
            summary: 'Task implementation meets all acceptance criteria with minor warnings.',
        },
        notes: 'CRITICAL: The pipeline validates these exact keys. Do NOT use status, changes, acceptance_criteria_check, ' +
            'reviewed_at, reviewer, or notes as top-level keys. verdict values "pass"/"fail" are auto-normalized to "approve"/"reject" by the pipeline. ' +
            'severity must be one of: critical, major, minor, nit. issues array defaults to empty if omitted.',
    },

    feature_request: {
        requiredKeys: ['feature_request'],
        keyTypes: {
            feature_request: 'string',
        },
        exampleStructure: {
            feature_request: 'Build all missing pages for the website...',
        },
        notes: 'Simple wrapper — the feature_request value is a free-form text description of what to build.',
    },
};

/**
 * Ordered list of pipeline phases. Each phase produces an artifact of the same name
 * (except user_psychology_research → market_research, ux_specification → ux_spec,
 * task_breakdown → tasks).
 */
export const PHASE_ORDER: string[] = [
    'competitor_research',
    'user_psychology_research',
    'ux_specification',
    'prd',
    'architecture',
    'engineering_plan',
    'task_breakdown',
    'implementation',
];

/** Maps phase names to their artifact type names (when they differ). */
export const PHASE_TO_ARTIFACT: Record<string, string> = {
    competitor_research: 'competitor_research',
    user_psychology_research: 'market_research',
    ux_specification: 'ux_spec',
    prd: 'prd',
    architecture: 'architecture',
    engineering_plan: 'engineering_plan',
    task_breakdown: 'tasks',
    implementation: 'review',
};

/** Convention-based path pattern for artifact storage. */
export const ARTIFACT_PATH_CONVENTION = 'workspace/artifacts/{type}.json';

/**
 * Returns all phases that come before the given phase in the pipeline.
 */
export function getPriorPhases(phase: string): string[] {
    const idx = PHASE_ORDER.indexOf(phase);
    if (idx <= 0) return [];
    return PHASE_ORDER.slice(0, idx);
}

/**
 * Returns all known artifact type names.
 */
export function getArtifactTypes(): string[] {
    return Object.keys(ARTIFACT_SCHEMAS);
}
