/**
 * Tests for Python dependency extraction.
 *
 * Covers:
 *  - External/unresolvable imports (import os, from typing import ...)
 *  - Relative imports (single dot, double dot)
 *  - Absolute imports that resolve to project files
 *  - Package imports via __init__.py
 *  - Multiple imports, empty files, deduplication
 *  - isDynamic is always false for Python imports
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractPythonDeps } from '../scripts/lib/python/python-dependency-extractor.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'py-dep-test-'));
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// External / unresolvable imports
// ---------------------------------------------------------------------------

describe('external imports', () => {
    it('returns empty for `import os` (stdlib, no project file)', () => {
        const content = 'import os\n';
        const filePath = path.join(tmpDir, 'main.py');
        writeFileSync(filePath, content);

        const deps = extractPythonDeps(filePath, content, tmpDir);

        expect(deps).toHaveLength(0);
    });

    it('returns empty for `from typing import Optional` (external package)', () => {
        const content = 'from typing import Optional\n';
        const filePath = path.join(tmpDir, 'main.py');
        writeFileSync(filePath, content);

        const deps = extractPythonDeps(filePath, content, tmpDir);

        expect(deps).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Relative imports
// ---------------------------------------------------------------------------

describe('relative imports', () => {
    it('resolves `from ..utils import helper` to the correct file', () => {
        // Structure:
        //   <tmpDir>/utils.py
        //   <tmpDir>/services/order.py  (contains: from ..utils import helper)
        writeFileSync(path.join(tmpDir, 'utils.py'), '# utils');
        mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
        const orderPath = path.join(tmpDir, 'services', 'order.py');
        const content = 'from ..utils import helper\n';
        writeFileSync(orderPath, content);

        const deps = extractPythonDeps(orderPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'utils.py'));
    });

    it('resolves `from .payment import process` to a sibling file', () => {
        // Structure:
        //   <tmpDir>/services/__init__.py
        //   <tmpDir>/services/payment.py
        //   <tmpDir>/services/order.py  (contains: from .payment import process)
        mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
        writeFileSync(path.join(tmpDir, 'services', '__init__.py'), '');
        writeFileSync(path.join(tmpDir, 'services', 'payment.py'), '# payment');
        const orderPath = path.join(tmpDir, 'services', 'order.py');
        const content = 'from .payment import process\n';
        writeFileSync(orderPath, content);

        const deps = extractPythonDeps(orderPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'services', 'payment.py'));
    });
});

// ---------------------------------------------------------------------------
// Absolute imports that resolve to project files
// ---------------------------------------------------------------------------

describe('absolute imports resolving to project files', () => {
    it('resolves `import models` to models.py at project root', () => {
        writeFileSync(path.join(tmpDir, 'models.py'), '# models');
        const mainPath = path.join(tmpDir, 'main.py');
        const content = 'import models\n';
        writeFileSync(mainPath, content);

        const deps = extractPythonDeps(mainPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'models.py'));
    });

    it('resolves `from utils import something` to utils/__init__.py', () => {
        // Structure:
        //   <tmpDir>/utils/__init__.py
        //   <tmpDir>/main.py
        mkdirSync(path.join(tmpDir, 'utils'), { recursive: true });
        writeFileSync(path.join(tmpDir, 'utils', '__init__.py'), '# utils package');
        const mainPath = path.join(tmpDir, 'main.py');
        const content = 'from utils import something\n';
        writeFileSync(mainPath, content);

        const deps = extractPythonDeps(mainPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'utils', '__init__.py'));
    });

    it('resolves `import utils` to utils/__init__.py', () => {
        mkdirSync(path.join(tmpDir, 'utils'), { recursive: true });
        writeFileSync(path.join(tmpDir, 'utils', '__init__.py'), '# utils package');
        const mainPath = path.join(tmpDir, 'main.py');
        const content = 'import utils\n';
        writeFileSync(mainPath, content);

        const deps = extractPythonDeps(mainPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'utils', '__init__.py'));
    });
});

// ---------------------------------------------------------------------------
// Multiple imports in one file
// ---------------------------------------------------------------------------

describe('multiple imports', () => {
    it('extracts all resolvable imports from a file', () => {
        // Structure:
        //   <tmpDir>/models.py
        //   <tmpDir>/config.py
        //   <tmpDir>/services/order.py
        writeFileSync(path.join(tmpDir, 'models.py'), '# models');
        writeFileSync(path.join(tmpDir, 'config.py'), '# config');
        mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
        const orderPath = path.join(tmpDir, 'services', 'order.py');
        const content = [
            'import os',
            'import models',
            'import config',
            'from typing import Optional',
        ].join('\n') + '\n';
        writeFileSync(orderPath, content);

        const deps = extractPythonDeps(orderPath, content, tmpDir);

        // os and typing are external (unresolvable), models and config resolve
        expect(deps).toHaveLength(2);
        const paths = deps.map(d => d.path);
        expect(paths).toContain(path.join(tmpDir, 'models.py'));
        expect(paths).toContain(path.join(tmpDir, 'config.py'));
    });
});

// ---------------------------------------------------------------------------
// Empty file
// ---------------------------------------------------------------------------

describe('empty file', () => {
    it('returns empty array for a file with no content', () => {
        const filePath = path.join(tmpDir, 'empty.py');
        writeFileSync(filePath, '');

        const deps = extractPythonDeps(filePath, '', tmpDir);

        expect(deps).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// isDynamic is always false
// ---------------------------------------------------------------------------

describe('isDynamic flag', () => {
    it('is always false for all Python imports', () => {
        writeFileSync(path.join(tmpDir, 'models.py'), '# models');
        mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
        writeFileSync(path.join(tmpDir, 'services', 'payment.py'), '# payment');
        const orderPath = path.join(tmpDir, 'services', 'order.py');
        const content = [
            'import models',
            'from .payment import process',
        ].join('\n') + '\n';
        writeFileSync(orderPath, content);

        const deps = extractPythonDeps(orderPath, content, tmpDir);

        expect(deps.length).toBeGreaterThan(0);
        for (const dep of deps) {
            expect(dep.isDynamic).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('deduplication', () => {
    it('returns only one entry when the same module is imported twice', () => {
        writeFileSync(path.join(tmpDir, 'models.py'), '# models');
        const mainPath = path.join(tmpDir, 'main.py');
        const content = [
            'import models',
            'from models import User',
        ].join('\n') + '\n';
        writeFileSync(mainPath, content);

        const deps = extractPythonDeps(mainPath, content, tmpDir);

        expect(deps).toHaveLength(1);
        expect(deps[0].path).toBe(path.join(tmpDir, 'models.py'));
    });
});
