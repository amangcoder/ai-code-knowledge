/**
 * EmbeddingProvider interface for the build pipeline.
 *
 * Returns Float32Array[] (not number[][]) because LanceDB requires Float32Array.
 * This is the scripts-side provider, separate from mcp-server/tools/lib/embedding-provider.ts
 * which only handles query-time embedding.
 */

export interface EmbeddingProvider {
    embed(texts: string[]): Promise<Float32Array[]>;
    dimensions(): number;
    modelName(): string;
    healthCheck(): Promise<void>;
}
