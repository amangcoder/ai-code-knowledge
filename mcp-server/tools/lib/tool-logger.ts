/**
 * Centralized logger for MCP tool calls that error, throw, or return empty data.
 * Writes to both .knowledge/tool-errors.log (append) and stderr.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CallToolResult } from '../../types.js';

type Severity = 'ERROR' | 'EMPTY_RESULT' | 'EXCEPTION';

let logStream: fs.WriteStream | null = null;

export function initToolLogger(knowledgeRoot: string): void {
    const logPath = path.join(knowledgeRoot, 'tool-errors.log');
    try {
        logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.on('error', () => {
            process.stderr.write('[tool-logger] Log file write error, falling back to stderr only\n');
            logStream = null;
        });
    } catch {
        process.stderr.write(`[tool-logger] Could not open ${logPath}, logging to stderr only\n`);
    }
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '...' : s;
}

function formatEntry(
    severity: Severity,
    toolName: string,
    args: Record<string, unknown>,
    msg: string,
    snippet?: string,
    stack?: string,
): string {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${severity}] tool=${toolName} args=${truncate(JSON.stringify(args), 200)} msg="${truncate(msg, 200)}"`;
    if (snippet !== undefined) {
        line += ` snippet="${truncate(snippet, 80)}"`;
    }
    if (stack) {
        line += ` stack="${truncate(stack, 200)}"`;
    }
    return line + '\n';
}

function writeLog(entry: string): void {
    process.stderr.write(`[tool-logger] ${entry}`);
    logStream?.write(entry);
}

export async function withToolLogging(
    toolName: string,
    args: Record<string, unknown>,
    handlerFn: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
    try {
        const result = await handlerFn();
        const text = result.content?.[0]?.text ?? '';

        if (result.isError) {
            writeLog(formatEntry('ERROR', toolName, args, text, text));
        } else if (text.trim().length === 0) {
            writeLog(formatEntry('EMPTY_RESULT', toolName, args, 'Response text is empty or whitespace-only', text));
        }

        return result;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        writeLog(formatEntry('EXCEPTION', toolName, args, msg, undefined, stack));

        return {
            content: [{ type: 'text', text: `Tool "${toolName}" threw an exception: ${msg}` }],
            isError: true,
        };
    }
}
