/**
 * Structured logging utility for the knowledge build pipeline.
 * All output goes to stderr (stdout is reserved for MCP protocol in server mode).
 */

export function logInfo(phase: string, message: string, filePath?: string): void {
    const fileCtx = filePath ? ` file=${filePath}` : '';
    process.stderr.write(`[${phase}]${fileCtx} ${message}\n`);
}

export function logError(phase: string, error: unknown, filePath?: string): void {
    const msg = error instanceof Error ? error.message : String(error);
    const fileCtx = filePath ? ` file=${filePath}` : '';
    process.stderr.write(`[${phase}]${fileCtx} ERROR: ${msg}\n`);
}

export function logWarn(phase: string, message: string, filePath?: string): void {
    const fileCtx = filePath ? ` file=${filePath}` : '';
    process.stderr.write(`[${phase}]${fileCtx} WARN: ${message}\n`);
}
