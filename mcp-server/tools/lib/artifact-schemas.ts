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
        requiredKeys: [
            'landscape_summary', 'competitors', 'feature_matrix',
            'differentiation_opportunities', 'competitive_risks',
            'positioning_recommendation', 'sources',
        ],
        keyTypes: {
            landscape_summary: 'string',
            competitors: 'Array<{name, type, description, target_customer, strengths[], weaknesses[], market_position, threat_level}>',
            feature_matrix: 'Record<feature, Record<competitor, boolean|string>>',
            differentiation_opportunities: 'string[]',
            competitive_risks: 'string[]',
            positioning_recommendation: 'string',
            sources: 'string[]',
        },
        exampleStructure: {
            landscape_summary: 'Overview of the competitive landscape...',
            competitors: [
                {
                    name: 'CompetitorX',
                    type: 'direct',
                    description: 'What they do...',
                    target_customer: 'Enterprise CTOs',
                    strengths: ['Strong brand'],
                    weaknesses: ['Slow delivery'],
                    market_position: 'leader',
                    threat_level: 'high',
                },
            ],
            feature_matrix: { 'AI consulting': { CompetitorX: true, CompetitorY: false } },
            differentiation_opportunities: ['Opportunity 1'],
            competitive_risks: ['Risk 1'],
            positioning_recommendation: 'Position as...',
            sources: ['https://example.com'],
        },
        notes: 'threat_level: low, medium, high. market_position: leader, challenger, niche, emerging.',
    },

    market_research: {
        requiredKeys: [
            'overall_assessment', 'reviewed_at', 'reviewer', 'scope',
            'artifacts_analyzed', 'target_personas_evaluated', 'cognitive_load_score',
            'findings', 'dark_patterns_detected', 'friction_points',
            'motivation_analysis', 'positive_patterns',
        ],
        keyTypes: {
            overall_assessment: 'string',
            reviewed_at: 'string (ISO date)',
            reviewer: 'string',
            scope: 'string',
            artifacts_analyzed: 'string[]',
            target_personas_evaluated: 'Array<{name, role, description}>',
            cognitive_load_score: 'number (1-10)',
            findings: 'Array<{category, finding, severity, recommendation}>',
            dark_patterns_detected: 'Array<{pattern, location, recommendation}>',
            friction_points: 'Array<{point, impact, recommendation}>',
            motivation_analysis: 'object',
            positive_patterns: 'string[]',
        },
        exampleStructure: {
            overall_assessment: 'Summary of research findings...',
            reviewed_at: '2026-01-15T10:00:00Z',
            reviewer: 'UX Research Agent',
            scope: 'End-user psychology and behavioral analysis',
            artifacts_analyzed: ['competitor_research'],
            target_personas_evaluated: [{ name: 'Rajiv', role: 'CTO', description: 'Technical decision maker' }],
            cognitive_load_score: 4,
            findings: [{ category: 'Navigation', finding: 'Finding text', severity: 'medium', recommendation: 'Fix suggestion' }],
            dark_patterns_detected: [],
            friction_points: [{ point: 'Contact form', impact: 'high', recommendation: 'Simplify fields' }],
            motivation_analysis: {},
            positive_patterns: ['Clear value proposition'],
        },
        notes: 'cognitive_load_score: 1 (minimal) to 10 (overwhelming). severity: low, medium, high, critical.',
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
        requiredKeys: [
            'meta', 'design_system_reference', 'site_wide_enhancements', 'user_flows',
            'screens', 'interactions', 'responsive_breakpoints', 'accessibility_requirements',
            'data_architecture', 'component_hierarchy', 'seo_and_performance', 'testing_requirements',
        ],
        keyTypes: {
            meta: 'object with version, created, author, scope',
            design_system_reference: 'object',
            site_wide_enhancements: 'array',
            user_flows: 'array',
            screens: 'array',
            interactions: 'array',
            responsive_breakpoints: 'array',
            accessibility_requirements: 'array',
            data_architecture: 'object',
            component_hierarchy: 'object',
            seo_and_performance: 'object',
            testing_requirements: 'array',
        },
        exampleStructure: {
            meta: { version: '1.0', created: '2026-01-15', author: 'Field Specialist', scope: 'PRD + Architecture validation' },
        },
        notes: 'Same structure as ux_spec. Used for independent validation of PRD + architecture alignment.',
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
        requiredKeys: ['verdict', 'issues', 'summary'],
        keyTypes: {
            verdict: 'string ("pass" | "fail" | "pass_with_warnings")',
            issues: 'Array<{severity, description, file?, line?, suggestion?}>',
            summary: 'string',
        },
        exampleStructure: {
            verdict: 'pass',
            issues: [
                { severity: 'warning', description: 'Missing alt text on image', file: 'src/pages/About.jsx', line: 42, suggestion: 'Add descriptive alt attribute' },
            ],
            summary: 'Task implementation meets all acceptance criteria with minor warnings.',
        },
        notes: 'CRITICAL: The pipeline validates these exact keys. Do NOT use status, changes, acceptance_criteria_check, ' +
            'reviewed_at, reviewer, or notes as top-level keys. verdict must be one of: "pass", "fail", "pass_with_warnings". ' +
            'issues array is required even if empty.',
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
