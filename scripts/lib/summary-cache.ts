import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { FileSummary, SymbolEntry } from '../../src/types.js';
import { Summarizer } from './summarizer.js';
import { atomicWrite } from './atomic-writer.js';

export class SummaryCache {
    private cache: Record<string, FileSummary> = {};
    private cachePath: string;

    constructor(projectRoot: string) {
        this.cachePath = path.join(projectRoot, '.knowledge', 'summaries', 'cache.json');
    }

    load(): Record<string, FileSummary> {
        if (fs.existsSync(this.cachePath)) {
            try {
                const data = fs.readFileSync(this.cachePath, 'utf8');
                this.cache = JSON.parse(data);
            } catch (err) {
                console.warn(`[SummaryCache] Failed to load cache: ${err}`);
                this.cache = {};
            }
        }
        return this.cache;
    }

    get(filePath: string, contentHash: string): FileSummary | undefined {
        const entry = this.cache[filePath];
        if (entry && entry.contentHash === contentHash) {
            return entry;
        }
        return undefined;
    }

    set(filePath: string, summary: FileSummary): void {
        this.cache[filePath] = summary;
    }

    async save(): Promise<void> {
        await atomicWrite(this.cachePath, JSON.stringify(this.cache, null, 2));
    }
}

/**
 * Gets a cached summary if the content hasn't changed, otherwise generates a new one.
 */
export async function getOrGenerateSummary(
    filePath: string,
    content: string,
    symbols: SymbolEntry[],
    summarizer: Summarizer,
    cache: SummaryCache
): Promise<FileSummary> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const cached = cache.get(filePath, hash);
    if (cached) {
        return cached;
    }

    const summary = await summarizer.summarizeFile(filePath, content, symbols);
    summary.contentHash = hash;
    cache.set(filePath, summary);
    return summary;
}
