import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TechStack {
    languages: string[];
    frameworks: string[];
    buildTools: string[];
    packageManager: string | null;
}

const FRAMEWORK_KEYWORDS: Record<string, string> = {
    'react': 'React',
    'react-dom': 'React',
    'next': 'Next.js',
    'vue': 'Vue',
    'nuxt': 'Nuxt',
    'angular': 'Angular',
    '@angular/core': 'Angular',
    'svelte': 'Svelte',
    'express': 'Express',
    'fastify': 'Fastify',
    'koa': 'Koa',
    'hono': 'Hono',
    'nestjs': 'NestJS',
    '@nestjs/core': 'NestJS',
    'django': 'Django',
    'flask': 'Flask',
    'fastapi': 'FastAPI',
    '@modelcontextprotocol/sdk': 'MCP SDK',
    'electron': 'Electron',
    'tailwindcss': 'Tailwind CSS',
    '@tailwindcss/postcss': 'Tailwind CSS',
};

const BUILD_TOOL_KEYWORDS: Record<string, string> = {
    'typescript': 'TypeScript',
    'tsx': 'tsx',
    'vitest': 'Vitest',
    'jest': 'Jest',
    'mocha': 'Mocha',
    'webpack': 'Webpack',
    'vite': 'Vite',
    'rollup': 'Rollup',
    'esbuild': 'esbuild',
    'eslint': 'ESLint',
    'prettier': 'Prettier',
    'turbo': 'Turborepo',
};

export function detectTechStack(projectRoot: string): TechStack {
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const buildTools = new Set<string>();
    let packageManager: string | null = null;

    // Detect from package.json
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };

            for (const dep of Object.keys(allDeps)) {
                if (FRAMEWORK_KEYWORDS[dep]) frameworks.add(FRAMEWORK_KEYWORDS[dep]);
                if (BUILD_TOOL_KEYWORDS[dep]) buildTools.add(BUILD_TOOL_KEYWORDS[dep]);
            }

            if (allDeps['typescript'] || allDeps['tsx']) languages.add('TypeScript');
            languages.add('JavaScript');
        } catch {
            // ignore parse errors
        }
    }

    // Language markers
    if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) languages.add('TypeScript');
    if (fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
        fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
        fs.existsSync(path.join(projectRoot, 'setup.py'))) {
        languages.add('Python');
    }
    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) languages.add('Go');
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) languages.add('Rust');

    // Package manager
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) packageManager = 'yarn';
    else if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) packageManager = 'bun';
    else if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) packageManager = 'npm';

    return {
        languages: [...languages],
        frameworks: [...frameworks],
        buildTools: [...buildTools],
        packageManager,
    };
}

export function classifyProjectType(projectRoot: string): string {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        if (fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) return 'Python Package';
        if (fs.existsSync(path.join(projectRoot, 'go.mod'))) return 'Go Module';
        if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) return 'Rust Crate';
        return 'Unknown';
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (pkg.workspaces) return 'Monorepo';
        if (allDeps['@modelcontextprotocol/sdk']) return 'MCP Server';
        if (allDeps['next']) return 'Next.js App';
        if (allDeps['react'] || allDeps['react-dom']) return 'React App';
        if (allDeps['vue']) return 'Vue App';
        if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hono']) return 'API Server';
        if (allDeps['electron']) return 'Electron App';
        if (pkg.bin) return 'CLI Tool';
        if (pkg.main || pkg.exports) return 'Library';
        return 'Node.js Project';
    } catch {
        return 'Node.js Project';
    }
}
