import * as fs from 'node:fs';
import * as path from 'node:path';
export function loadIndex(knowledgeRoot) {
    const filePath = path.join(knowledgeRoot, 'index.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function loadSymbols(knowledgeRoot) {
    const filePath = path.join(knowledgeRoot, 'symbols.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
export function loadDependencies(knowledgeRoot) {
    const filePath = path.join(knowledgeRoot, 'dependencies.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function loadSummaryCache(knowledgeRoot) {
    const filePath = path.join(knowledgeRoot, 'summaries', 'cache.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
