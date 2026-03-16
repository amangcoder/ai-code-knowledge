import { Project } from 'ts-morph';
import { extractFileDeps, type ImportInfo } from './lib/dependency-extractor.js';
import { buildDependencyGraph } from './lib/dependency-graph.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
    const args = process.argv.slice(2);
    const rootIndex = args.indexOf('--root');
    const projectRoot = rootIndex !== -1 ? path.resolve(args[rootIndex + 1]) : process.cwd();

    console.log(`Building dependency graph for: ${projectRoot}`);

    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsconfigPath);

    const project = new Project({
        tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
        skipAddingFilesFromTsConfig: false,
    });

    if (!hasTsConfig) {
        project.addSourceFilesAtPaths(path.join(projectRoot, 'src/**/*.ts'));
    }

    const sourceFiles = project.getSourceFiles().filter(sf => sf.getFilePath().startsWith(path.join(projectRoot, 'src')));
    const fileDeps: Record<string, ImportInfo[]> = {};

    for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        const deps = extractFileDeps(sourceFile);
        fileDeps[filePath] = deps;
    }

    const dependencyGraph = buildDependencyGraph(fileDeps, projectRoot);

    // Ensure .knowledge directory exists
    const knowledgeDir = path.join(projectRoot, '.knowledge');
    if (!fs.existsSync(knowledgeDir)) {
        fs.mkdirSync(knowledgeDir, { recursive: true });
    }

    const depsFile = path.join(knowledgeDir, 'dependencies.json');
    fs.writeFileSync(depsFile, JSON.stringify(dependencyGraph, null, 2));

    console.log(`Mapped dependencies for ${sourceFiles.length} files. Found ${dependencyGraph.cycles.length} cycles.`);
    console.log(`Wrote dependency graph to ${depsFile}`);

    // Update index.json to reflect the completed build
    const indexFile = path.join(knowledgeDir, 'index.json');
    if (fs.existsSync(indexFile)) {
        const raw = fs.readFileSync(indexFile, 'utf-8');
        const index = JSON.parse(raw);
        index.hasDependencies = true;
        index.fileCount = sourceFiles.length;
        index.lastBuilt = new Date().toISOString();
        fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
        console.log(`Updated index.json (hasDependencies=true, fileCount=${sourceFiles.length})`);
    }
}

main().catch(err => {
    console.error("Error building dependencies:", err);
    process.exit(1);
});
