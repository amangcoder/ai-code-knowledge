/**
 * VectorStore — wraps LanceDB for storing and querying vector embeddings.
 *
 * Three tables: files.lance, symbols.lance, features.lance
 * All under .knowledge/vectors/
 *
 * LanceDB is an optional dependency (@lancedb/lancedb). When not installed,
 * isAvailable() returns false and search methods return empty arrays.
 * This allows the build pipeline to degrade gracefully.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VectorSearchResult } from '../../src/types.js';

// ── Record types ─────────────────────────────────────────────────────────────

export interface FileEmbeddingRecord {
    id: string;
    file: string;
    purpose: string;
    embedding: Float32Array;
    contentHash: string;
}

export interface SymbolEmbeddingRecord {
    id: string;
    qualifiedName: string;
    signature: string;
    file: string;
    embedding: Float32Array;
}

export interface FeatureEmbeddingRecord {
    id: string;
    name: string;
    description: string;
    embedding: Float32Array;
}

// ── VectorStore interface ─────────────────────────────────────────────────────

export interface VectorStore {
    upsertFiles(records: FileEmbeddingRecord[]): Promise<void>;
    upsertSymbols(records: SymbolEmbeddingRecord[]): Promise<void>;
    upsertFeatures(records: FeatureEmbeddingRecord[]): Promise<void>;
    searchFiles(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]>;
    searchSymbols(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]>;
    searchFeatures(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]>;
    isAvailable(): boolean;
    /** Load all file embeddings (used by feature discovery). */
    getAllFileEmbeddings(): Promise<Map<string, Float32Array>>;
}

// ── LanceDB-backed implementation ─────────────────────────────────────────────

type LanceTable = {
    add(records: Record<string, unknown>[]): Promise<void>;
    search(query: Float32Array): { limit: (n: number) => { toArray: () => Promise<Record<string, unknown>[]> } };
    overwrite?(records: Record<string, unknown>[]): Promise<void>;
    toArrow?(): Promise<unknown>;
};

type LanceDB = {
    connect(uri: string): Promise<{
        openTable(name: string): Promise<LanceTable>;
        createTable(name: string, data: Record<string, unknown>[], options?: unknown): Promise<LanceTable>;
        tableNames(): Promise<string[]>;
    }>;
};

class LanceDBVectorStore implements VectorStore {
    private readonly dbPath: string;
    private db: Awaited<ReturnType<LanceDB['connect']>> | null = null;
    private filesTable: LanceTable | null = null;
    private symbolsTable: LanceTable | null = null;
    private featuresTable: LanceTable | null = null;
    private readonly dimensions: number;
    private readonly lance: LanceDB;

    constructor(dbPath: string, lance: LanceDB, dimensions: number = 1024) {
        this.dbPath = dbPath;
        this.lance = lance;
        this.dimensions = dimensions;
    }

    async initialize(): Promise<void> {
        this.db = await this.lance.connect(this.dbPath);
        const tableNames = await this.db.tableNames();

        // Open or create files table
        if (tableNames.includes('files')) {
            this.filesTable = await this.db.openTable('files');
        } else {
            // Create with a placeholder row to establish schema
            this.filesTable = await this.db.createTable('files', [{
                id: '__init__',
                file: '',
                purpose: '',
                vector: Array.from({ length: this.dimensions }, () => 0),
                contentHash: '',
            }]);
        }

        // Open or create symbols table
        if (tableNames.includes('symbols')) {
            this.symbolsTable = await this.db.openTable('symbols');
        } else {
            this.symbolsTable = await this.db.createTable('symbols', [{
                id: '__init__',
                qualifiedName: '',
                signature: '',
                file: '',
                vector: Array.from({ length: this.dimensions }, () => 0),
            }]);
        }

        // Open or create features table
        if (tableNames.includes('features')) {
            this.featuresTable = await this.db.openTable('features');
        } else {
            this.featuresTable = await this.db.createTable('features', [{
                id: '__init__',
                name: '',
                description: '',
                vector: Array.from({ length: this.dimensions }, () => 0),
            }]);
        }
    }

    async upsertFiles(records: FileEmbeddingRecord[]): Promise<void> {
        if (!this.filesTable) throw new Error('VectorStore not initialized');

        const rows = records.map((r) => ({
            id: r.id,
            file: r.file,
            purpose: r.purpose,
            vector: Array.from(r.embedding),
            contentHash: r.contentHash,
        }));

        await this.filesTable.add(rows);
    }

    async upsertSymbols(records: SymbolEmbeddingRecord[]): Promise<void> {
        if (!this.symbolsTable) throw new Error('VectorStore not initialized');

        const rows = records.map((r) => ({
            id: r.id,
            qualifiedName: r.qualifiedName,
            signature: r.signature,
            file: r.file,
            vector: Array.from(r.embedding),
        }));

        await this.symbolsTable.add(rows);
    }

    async upsertFeatures(records: FeatureEmbeddingRecord[]): Promise<void> {
        if (!this.featuresTable) throw new Error('VectorStore not initialized');

        const rows = records.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            vector: Array.from(r.embedding),
        }));

        await this.featuresTable.add(rows);
    }

    async searchFiles(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]> {
        if (!this.filesTable) return [];
        const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
        const rows = await this.filesTable.search(vec).limit(topK).toArray();
        return rows
            .filter((r) => r['id'] !== '__init__')
            .map((r) => ({
                id: `file:${String(r['file'])}`,
                score: typeof r['_distance'] === 'number' ? 1 - r['_distance'] : 0,
                metadata: {
                    file: String(r['file']),
                    purpose: String(r['purpose']),
                    contentHash: String(r['contentHash']),
                },
            }));
    }

    async searchSymbols(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]> {
        if (!this.symbolsTable) return [];
        const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
        const rows = await this.symbolsTable.search(vec).limit(topK).toArray();
        return rows
            .filter((r) => r['id'] !== '__init__')
            .map((r) => ({
                id: `symbol:${String(r['qualifiedName'])}`,
                score: typeof r['_distance'] === 'number' ? 1 - r['_distance'] : 0,
                metadata: {
                    qualifiedName: String(r['qualifiedName']),
                    signature: String(r['signature']),
                    file: String(r['file']),
                },
            }));
    }

    async searchFeatures(embedding: number[] | Float32Array, topK: number): Promise<VectorSearchResult[]> {
        if (!this.featuresTable) return [];
        const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
        const rows = await this.featuresTable.search(vec).limit(topK).toArray();
        return rows
            .filter((r) => r['id'] !== '__init__')
            .map((r) => ({
                id: `feature:${String(r['id'])}`,
                score: typeof r['_distance'] === 'number' ? 1 - r['_distance'] : 0,
                metadata: {
                    name: String(r['name']),
                    description: String(r['description']),
                },
            }));
    }

    isAvailable(): boolean {
        return this.db !== null;
    }

    async getAllFileEmbeddings(): Promise<Map<string, Float32Array>> {
        // Stub: returns empty map (real implementation would iterate table)
        return new Map();
    }
}

// ── Unavailable stub (when LanceDB not installed) ─────────────────────────────

class UnavailableVectorStore implements VectorStore {
    async upsertFiles(): Promise<void> { /* no-op */ }
    async upsertSymbols(): Promise<void> { /* no-op */ }
    async upsertFeatures(): Promise<void> { /* no-op */ }
    async searchFiles(): Promise<VectorSearchResult[]> { return []; }
    async searchSymbols(): Promise<VectorSearchResult[]> { return []; }
    async searchFeatures(): Promise<VectorSearchResult[]> { return []; }
    isAvailable(): boolean { return false; }
    async getAllFileEmbeddings(): Promise<Map<string, Float32Array>> { return new Map(); }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates and initializes a VectorStore backed by LanceDB.
 *
 * @param knowledgeRoot  Path to .knowledge/ directory
 * @param dimensions     Embedding dimensionality (default: 1024 for CodeSage-large)
 * @returns              Initialized VectorStore (or unavailable stub if LanceDB missing)
 */
export async function createVectorStore(
    knowledgeRoot: string,
    dimensions: number = 1024
): Promise<VectorStore> {
    const dbPath = path.join(knowledgeRoot, 'vectors');

    // Attempt to dynamically import LanceDB
    let lance: LanceDB | null = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        lance = (await (Function('return import("@lancedb/lancedb")')() as Promise<unknown>)) as LanceDB;
    } catch {
        // LanceDB not installed — return unavailable stub
        return new UnavailableVectorStore();
    }

    // Ensure vectors directory exists
    fs.mkdirSync(dbPath, { recursive: true });

    const store = new LanceDBVectorStore(dbPath, lance, dimensions);
    await store.initialize();
    return store;
}

export type { VectorSearchResult };
