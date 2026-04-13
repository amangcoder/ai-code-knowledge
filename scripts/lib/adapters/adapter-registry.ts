import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LanguageAdapter } from './language-adapter.js';

/**
 * Registry that manages language adapters and provides language detection,
 * file routing, and glob pattern generation from registered adapters.
 *
 * Replaces the hardcoded language-detection.ts with a dynamic, extensible system.
 */
export class AdapterRegistry {
    private adapters = new Map<string, LanguageAdapter>();
    private extensionMap = new Map<string, LanguageAdapter>();

    /** Register an adapter. Maps all its extensions for lookup. */
    register(adapter: LanguageAdapter): void {
        this.adapters.set(adapter.language, adapter);
        for (const ext of adapter.extensions) {
            this.extensionMap.set(ext.toLowerCase(), adapter);
        }
    }

    /** Get adapter by file extension (e.g., '.ts'). */
    getByExtension(ext: string): LanguageAdapter | undefined {
        return this.extensionMap.get(ext.toLowerCase());
    }

    /** Get adapter by language name (e.g., 'typescript'). */
    getByLanguage(language: string): LanguageAdapter | undefined {
        return this.adapters.get(language);
    }

    /** Get adapter for a file path based on its extension. */
    getForFile(filePath: string): LanguageAdapter | undefined {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensionMap.get(ext);
    }

    /** All registered adapters. */
    getAllAdapters(): LanguageAdapter[] {
        return Array.from(this.adapters.values());
    }

    /**
     * Detect which languages are present in a project by checking project markers
     * and optionally scanning for source files.
     */
    detectProjectLanguages(projectRoot: string): string[] {
        const found = new Set<string>();

        // Check marker files for each adapter
        for (const adapter of this.adapters.values()) {
            for (const marker of adapter.projectMarkers) {
                if (fs.existsSync(path.join(projectRoot, marker))) {
                    found.add(adapter.language);
                    break;
                }
            }
        }

        // If no markers found, do a shallow scan for source files
        if (found.size === 0) {
            this.scanForLanguages(projectRoot, found, 0, 3);
        }

        return Array.from(found);
    }

    /** Returns combined glob patterns for all registered adapters. */
    getSourceGlobs(): string[] {
        const exts = this.getAllAdapters()
            .flatMap(a => a.extensions)
            .map(e => e.slice(1)); // remove leading dots
        if (exts.length === 0) return [];
        if (exts.length === 1) return [`**/*.${exts[0]}`];
        return [`**/*.{${exts.join(',')}}`];
    }

    /** Returns combined ignore directory patterns from all adapters. */
    getIgnorePatterns(): string[] {
        const dirs = new Set<string>();
        for (const adapter of this.adapters.values()) {
            for (const dir of adapter.ignoreDirs) {
                dirs.add(dir);
            }
        }
        return Array.from(dirs);
    }

    /** Returns ignore dirs as glob patterns suitable for chokidar/minimatch. */
    getIgnoreGlobs(): string[] {
        return this.getIgnorePatterns().map(d => `**/${d}/**`);
    }

    /**
     * Groups file paths by their language adapter.
     * Files without a matching adapter are silently skipped.
     */
    groupFilesByLanguage(filePaths: string[]): Map<string, string[]> {
        const grouped = new Map<string, string[]>();
        for (const fp of filePaths) {
            const adapter = this.getForFile(fp);
            if (!adapter) continue;
            let list = grouped.get(adapter.language);
            if (!list) {
                list = [];
                grouped.set(adapter.language, list);
            }
            list.push(fp);
        }
        return grouped;
    }

    /** Detect language for a single file path. Returns null if unsupported. */
    detectLanguage(filePath: string): string | null {
        const adapter = this.getForFile(filePath);
        return adapter?.language ?? null;
    }

    private scanForLanguages(dir: string, found: Set<string>, depth: number, maxDepth: number): void {
        if (depth > maxDepth || found.size >= this.adapters.size) return;

        const ignoreDirs = new Set(this.getIgnorePatterns());
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
                    this.scanForLanguages(path.join(dir, entry.name), found, depth + 1, maxDepth);
                }
            } else if (entry.isFile()) {
                const adapter = this.getForFile(entry.name);
                if (adapter) found.add(adapter.language);
            }
            if (found.size >= this.adapters.size) return;
        }
    }
}
