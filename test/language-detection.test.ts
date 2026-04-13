import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
    detectLanguage,
    detectProjectLanguages,
    getSourceGlobs,
    getIgnorePatterns,
} from '../scripts/lib/language-detection.js';
import type { SupportedLanguage } from '../scripts/lib/language-detection.js';

let tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'lang-detect-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
});

describe('detectLanguage', () => {
    it('returns "typescript" for .ts files', () => {
        expect(detectLanguage('src/app.ts')).toBe('typescript');
    });

    it('returns "typescript" for .tsx files', () => {
        expect(detectLanguage('components/Button.tsx')).toBe('typescript');
    });

    it('returns "javascript" for .js files', () => {
        expect(detectLanguage('lib/utils.js')).toBe('javascript');
    });

    it('returns "javascript" for .jsx files', () => {
        expect(detectLanguage('components/App.jsx')).toBe('javascript');
    });

    it('returns "javascript" for .mjs files', () => {
        expect(detectLanguage('config/setup.mjs')).toBe('javascript');
    });

    it('returns "python" for .py files', () => {
        expect(detectLanguage('scripts/main.py')).toBe('python');
    });

    it('returns null for .rs files', () => {
        expect(detectLanguage('src/main.rs')).toBeNull();
    });

    it('returns null for .go files', () => {
        expect(detectLanguage('cmd/server.go')).toBeNull();
    });

    it('returns null for .css files', () => {
        expect(detectLanguage('styles/app.css')).toBeNull();
    });
});

describe('detectProjectLanguages', () => {
    it('includes "typescript" when tsconfig.json is present', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'tsconfig.json'), '{}');

        const languages = detectProjectLanguages(dir);
        expect(languages).toContain('typescript');
    });

    it('includes "javascript" when package.json is present', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'package.json'), '{}');

        const languages = detectProjectLanguages(dir);
        expect(languages).toContain('javascript');
    });

    it('includes "python" when requirements.txt is present', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'requirements.txt'), '');

        const languages = detectProjectLanguages(dir);
        expect(languages).toContain('python');
    });

    it('includes "python" when pyproject.toml is present', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'pyproject.toml'), '');

        const languages = detectProjectLanguages(dir);
        expect(languages).toContain('python');
    });

    it('includes both "typescript" and "python" when tsconfig.json and requirements.txt are present', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
        writeFileSync(path.join(dir, 'requirements.txt'), '');

        const languages = detectProjectLanguages(dir);
        expect(languages).toContain('typescript');
        expect(languages).toContain('python');
    });
});

describe('getSourceGlobs', () => {
    it('returns TS globs for ["typescript"]', () => {
        const globs = getSourceGlobs(['typescript']);
        expect(globs).toContain('**/*.ts');
        expect(globs).toContain('**/*.tsx');
    });

    it('returns Python globs for ["python"]', () => {
        const globs = getSourceGlobs(['python']);
        expect(globs).toContain('**/*.py');
    });

    it('returns both TS and JS globs for ["typescript", "javascript"]', () => {
        const globs = getSourceGlobs(['typescript', 'javascript']);
        expect(globs).toContain('**/*.ts');
        expect(globs).toContain('**/*.tsx');
        expect(globs).toContain('**/*.js');
        expect(globs).toContain('**/*.jsx');
        expect(globs).toContain('**/*.mjs');
    });
});

describe('getIgnorePatterns', () => {
    it('returns ignore patterns for common directories', () => {
        const patterns = getIgnorePatterns();
        expect(patterns).toContain('**/node_modules/**');
        expect(patterns).toContain('**/dist/**');
        expect(patterns).toContain('**/.git/**');
        expect(patterns).toContain('**/__pycache__/**');
    });
});
