import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Writes data to a file atomically by writing to a .tmp file first, then renaming.
 * Creates parent directories as needed. If the rename fails, the .tmp file is cleaned up.
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;

    try {
        await fs.writeFile(tmpPath, data, 'utf8');
        await fs.rename(tmpPath, filePath);
    } catch (err) {
        // Best-effort cleanup of the .tmp file on failure
        try {
            await fs.unlink(tmpPath);
        } catch {
            // Ignore cleanup errors
        }
        throw err;
    }
}
