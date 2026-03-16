import * as path from 'node:path';

/**
 * Groups files by their parent module directory.
 * @param filePaths List of absolute file paths.
 * @param projectRoot Absolute path to the project root.
 * @returns A mapping from module name to an array of relative file paths.
 */
export function groupFilesByModule(filePaths: string[], projectRoot: string): Record<string, string[]> {
    const modules: Record<string, string[]> = {};

    for (const filePath of filePaths) {
        const relativePath = path.relative(projectRoot, filePath);
        const moduleName = path.basename(path.dirname(filePath));

        if (!modules[moduleName]) {
            modules[moduleName] = [];
        }
        modules[moduleName].push(relativePath);
    }

    return modules;
}
