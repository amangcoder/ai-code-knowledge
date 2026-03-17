import { describe, it, expect } from 'vitest';
import { groupFilesByModule } from '../scripts/lib/module-grouper.js';
import * as path from 'node:path';

const PROJECT_ROOT = '/project';

function abs(...parts: string[]): string {
    return path.join(PROJECT_ROOT, ...parts);
}

describe('groupFilesByModule', () => {
    it('groups files by first directory segment', () => {
        const files = [
            abs('src', 'auth.ts'),
            abs('src', 'services', 'user.ts'),
            abs('scripts', 'build.ts'),
        ];
        const result = groupFilesByModule(files, PROJECT_ROOT);
        expect(Object.keys(result)).toContain('src');
        expect(Object.keys(result)).toContain('scripts');
        expect(result['src']).toHaveLength(2);
        expect(result['scripts']).toHaveLength(1);
    });

    it('uses project root dir name for root-level files', () => {
        const files = [abs('index.ts'), abs('config.ts')];
        const result = groupFilesByModule(files, PROJECT_ROOT);
        expect(Object.keys(result)).toContain('project');
        expect(result['project']).toHaveLength(2);
    });

    it('uses moduleRoots config when provided', () => {
        const files = [
            abs('packages', 'api', 'src', 'index.ts'),
            abs('packages', 'web', 'src', 'index.ts'),
            abs('packages', 'api', 'src', 'routes.ts'),
        ];
        const result = groupFilesByModule(files, PROJECT_ROOT, {
            moduleRoots: ['packages/*'],
        });
        expect(Object.keys(result)).toContain('packages/api');
        expect(Object.keys(result)).toContain('packages/web');
        expect(result['packages/api']).toHaveLength(2);
        expect(result['packages/web']).toHaveLength(1);
    });

    it('falls back to default grouping when moduleRoots do not match', () => {
        const files = [abs('lib', 'utils.ts')];
        const result = groupFilesByModule(files, PROJECT_ROOT, {
            moduleRoots: ['packages/*'],
        });
        // "lib" doesn't match "packages/*", so falls back to first dir segment
        expect(Object.keys(result)).toContain('lib');
    });

    it('handles multiple moduleRoots', () => {
        const files = [
            abs('packages', 'core', 'index.ts'),
            abs('apps', 'web', 'main.ts'),
        ];
        const result = groupFilesByModule(files, PROJECT_ROOT, {
            moduleRoots: ['packages/*', 'apps/*'],
        });
        expect(Object.keys(result)).toContain('packages/core');
        expect(Object.keys(result)).toContain('apps/web');
    });

    it('handles empty file list', () => {
        const result = groupFilesByModule([], PROJECT_ROOT);
        expect(Object.keys(result)).toHaveLength(0);
    });
});
