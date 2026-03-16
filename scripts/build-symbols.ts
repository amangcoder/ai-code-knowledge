import { Project } from 'ts-morph';
import { extractSymbols } from './lib/symbol-extractor.js';
import { buildCallGraph, invertCallGraph } from './lib/call-graph.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SymbolEntry } from '../src/types.js';

async function main() {
    const args = process.argv.slice(2);
    const rootIndex = args.indexOf('--root');
    const projectRoot = rootIndex !== -1 ? path.resolve(args[rootIndex + 1]) : process.cwd();

    console.log(`Building symbol graph for: ${projectRoot}`);

    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsconfigPath);

    const project = new Project({
        tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
        skipAddingFilesFromTsConfig: false,
    });

    if (!hasTsConfig) {
        project.addSourceFilesAtPaths(path.join(projectRoot, 'src/**/*.ts'));
    }

    const sourceFiles = project.getSourceFiles();
    let allSymbols: SymbolEntry[] = [];

    for (const sourceFile of sourceFiles) {
        const symbols = extractSymbols(sourceFile, projectRoot);
        allSymbols = allSymbols.concat(symbols);
    }

    console.log(`Extracted metadata for ${allSymbols.length} symbols from ${sourceFiles.length} files.`);

    // Build call graph
    console.log("Linking call graph...");
    const symbolsWithCalls = buildCallGraph(project, allSymbols);

    // Invert call graph
    console.log("Inverting call graph...");
    const symbolsWithCalledBy = invertCallGraph(symbolsWithCalls);

    // Ensure .knowledge directory exists
    const knowledgeDir = path.join(projectRoot, '.knowledge');
    if (!fs.existsSync(knowledgeDir)) {
        fs.mkdirSync(knowledgeDir, { recursive: true });
    }

    const symbolsFile = path.join(knowledgeDir, 'symbols.json');
    fs.writeFileSync(symbolsFile, JSON.stringify(symbolsWithCalledBy, null, 2));

    console.log(`Extracted ${symbolsWithCalledBy.length} symbols from ${sourceFiles.length} files.`);
    console.log(`Wrote symbols to ${symbolsFile}`);

    // Update index.json to reflect the completed symbol build
    const indexFile = path.join(knowledgeDir, 'index.json');
    if (fs.existsSync(indexFile)) {
        const raw = fs.readFileSync(indexFile, 'utf-8');
        const index = JSON.parse(raw);
        index.hasSymbols = true;
        index.fileCount = sourceFiles.length;
        index.lastBuilt = new Date().toISOString();
        fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
        console.log(`Updated index.json (hasSymbols=true, fileCount=${sourceFiles.length})`);
    }
}

main().catch(err => {
    console.error("Error building symbols:", err);
    process.exit(1);
});
