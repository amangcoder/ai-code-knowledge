import * as fs from 'node:fs';
import * as path from 'node:path';

export type SupportedLanguage = 'typescript' | 'javascript' | 'python';

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.py': 'python',
};

const IGNORE_DIRS = new Set([
    'node_modules', 'venv', '.venv', '__pycache__', 'dist', 'build',
    '.git', '.next', '.nuxt', 'coverage', '.tox', 'egg-info',
]);

const FILE_GLOBS: Record<SupportedLanguage, string[]> = {
    typescript: ['**/*.ts', '**/*.tsx'],
    javascript: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    python: ['**/*.py'],
};

/**
 * Detects the language of a file based on its extension.
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
}

/**
 * Detects which languages are present in a project by checking marker files
 * and scanning for source files.
 */
export function detectProjectLanguages(projectRoot: string): SupportedLanguage[] {
    const languages = new Set<SupportedLanguage>();

    // Check marker files
    if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        languages.add('typescript');
    }
    if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        // package.json implies JS; if tsconfig also exists, TS is already added
        languages.add('javascript');
    }
    const pythonMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];
    for (const marker of pythonMarkers) {
        if (fs.existsSync(path.join(projectRoot, marker))) {
            languages.add('python');
            break;
        }
    }

    // If no markers found, do a shallow scan for source files
    if (languages.size === 0) {
        scanForLanguages(projectRoot, languages, 0, 3);
    }

    return Array.from(languages);
}

/**
 * Recursively scans directories (up to maxDepth) looking for source files.
 */
function scanForLanguages(dir: string, found: Set<SupportedLanguage>, depth: number, maxDepth: number): void {
    if (depth > maxDepth || found.size >= 3) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                scanForLanguages(path.join(dir, entry.name), found, depth + 1, maxDepth);
            }
        } else if (entry.isFile()) {
            const lang = detectLanguage(entry.name);
            if (lang) found.add(lang);
        }
        if (found.size >= 3) return;
    }
}

/**
 * Returns glob patterns for discovering source files of the given languages.
 */
export function getSourceGlobs(languages: SupportedLanguage[]): string[] {
    return languages.flatMap(lang => FILE_GLOBS[lang]);
}

/**
 * Returns glob ignore patterns for common non-source directories.
 */
export function getIgnorePatterns(): string[] {
    return Array.from(IGNORE_DIRS).map(d => `**/${d}/**`);
}
