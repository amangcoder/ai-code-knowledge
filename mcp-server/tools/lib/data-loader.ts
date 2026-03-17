import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnowledgeIndex, SymbolEntry, DependencyGraph, FileSummary } from '../../types.js';

export function loadIndex(knowledgeRoot: string): KnowledgeIndex | null {
    const filePath = path.join(knowledgeRoot, 'index.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as KnowledgeIndex;
    } catch {
        return null;
    }
}

export function loadSymbols(knowledgeRoot: string): SymbolEntry[] | null {
    const filePath = path.join(knowledgeRoot, 'symbols.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as SymbolEntry[] : null;
    } catch {
        return null;
    }
}

export function loadDependencies(knowledgeRoot: string): DependencyGraph | null {
    const filePath = path.join(knowledgeRoot, 'dependencies.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as DependencyGraph;
    } catch {
        return null;
    }
}

export function loadSummaryCache(knowledgeRoot: string): Record<string, FileSummary> | null {
    const filePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as Record<string, FileSummary>;
    } catch {
        return null;
    }
}
