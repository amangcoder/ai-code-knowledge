# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-03-23

### Added

#### Vector Reranking & Similarity
- **`find_symbol` vector reranking** — When a symbol search returns >20 results and VectorStore is available, results are reranked by semantic similarity to return the top 10 most relevant symbols. Falls back to existing Levenshtein-based ranking when vectors are unavailable.
- **Similar Files in `get_implementation_context`** — New "Similar Files" section powered by vector proximity (REQ-016). Embeds the file's purpose text and returns semantically related files from the VectorStore.
- **Key Features in `get_project_overview`** — Project overview now includes a "Key Features" section sourced from Phase 9 feature discovery groups.

#### Type Consolidation
- `GetFeatureContextArgs` interface moved to shared `src/types.ts` and `mcp-server/types.ts`, removing inline definition from `get-feature-context.ts`.

#### Tests
- 7 new test suites: `backward-compatibility`, `bm25`, `clustering`, `hybrid-retriever`, `knowledge-graph`, `query-router`, `working-memory` — covering core retrieval and infrastructure modules.

### Changed
- **Default embedding model** in build pipeline changed from `local` → `huggingface` (`scripts/lib/embeddings/embedding-factory.ts`).
- `find_symbol` and `get_implementation_context` handlers are now `async` (returning `Promise<CallToolResult>`) to support vector operations.

---

## [0.5.0] - 2026-03-18

### Changed

#### Embedding Model Upgrade
- Switched default embedding model from `Salesforce/codesage-base` (768 dims) to `Salesforce/codesage-large` (1024 dims) for higher quality code embeddings (~1.3B params vs ~110M).
- Updated all default dimensions from 768 to 1024 across build-pipeline providers, MCP-server providers, and vector store.
- Local embedding server (`scripts/embedding-server.py`) now defaults to `codesage/codesage-large`.
- **Breaking**: Existing `.knowledge/vectors/` must be deleted and rebuilt (`rm -rf .knowledge/vectors/ && npm run build-knowledge`).

---

## [0.4.0] - 2026-03-18

### Added

#### Multi-Language Support
- **`DartAdapter`** (`scripts/lib/adapters/dart-adapter.ts`) — Dart language adapter with symbol and dependency extraction.
- **`GoAdapter`** (`scripts/lib/adapters/go-adapter.ts`) — Go language adapter; includes `GoSymbolExtractor` and `GoDependencyExtractor` (`scripts/lib/go/`).
- **`JavaAdapter`** (`scripts/lib/adapters/java-adapter.ts`) — Java language adapter with symbol and dependency extraction.
- **`KotlinAdapter`** (`scripts/lib/adapters/kotlin-adapter.ts`) — Kotlin language adapter with symbol and dependency extraction.
- **`RustAdapter`** (`scripts/lib/adapters/rust-adapter.ts`) — Rust language adapter; includes `RustSymbolExtractor` and `RustDependencyExtractor` (`scripts/lib/rust/`).
- **`SwiftAdapter`** (`scripts/lib/adapters/swift-adapter.ts`) — Swift language adapter; includes `SwiftSymbolExtractor` and `SwiftDependencyExtractor` (`scripts/lib/swift/`).
- Default adapter registry (`createDefaultRegistry`) now registers all 8 language adapters: TypeScript/JS, Python, Dart, Go, Java, Kotlin, Rust, Swift.

#### Tool Logging
- **`initToolLogger` / `withToolLogging`** (`mcp-server/tools/lib/tool-logger.ts`) — Structured per-tool invocation logging. All composite and targeted MCP tools are now wrapped with `withToolLogging` for observability.

#### Directory Exclusions
- `build-knowledge.ts` — New `--exclude <dir>` CLI flag (repeatable, comma-separated) to skip directories during source file collection.
- `collectSourceFiles` — New `excludeDirs` parameter supporting bare directory names and relative paths; merged with config-level `exclude` list.

#### Embedding Cost Projection
- Embedding phase now reports estimated token count and projected API cost for both `text-embedding-3-small` and `text-embedding-ada-002` after each run.
- `EmbeddingPhaseResult` — New `estimatedTokens` and `estimatedApiCostUsd` fields.

---

## [0.3.0] - 2026-03-17

### Added

#### Embedding Providers
- **`HuggingFaceEmbeddingProvider`** (`scripts/lib/embeddings/huggingface-embedding-provider.ts`) — HuggingFace Inference API backed provider using `Salesforce/codesage-base` (768 dims) by default. Batches inputs in chunks of 32, supports optional `HF_API_TOKEN` for higher rate limits.
- **`LocalEmbeddingProvider`** (`scripts/lib/embeddings/local-embedding-provider.ts`) — Local Python sentence-transformers server provider. Talks to `POST /embed` on a configurable base URL (default `http://localhost:8484`).
- **`scripts/embedding-server.py`** — Python FastAPI server that loads CodeSage locally via `sentence_transformers`, exposes `/embed` and `/health` endpoints. Allows fully offline embedding generation after initial model download.
- **`scripts/requirements.txt`** — Python dependencies for the embedding server.
- MCP-server `HuggingFaceEmbeddingProvider` and `LocalEmbeddingProvider` added to `mcp-server/tools/lib/embedding-provider.ts` for query-time embedding.

#### Build Pipeline
- `build-knowledge.ts` now supports `--skip-vectors`, `--skip-features`, and `--rebuild-features` CLI flags.

### Changed

#### Default Embedding Provider
- **Build pipeline** (`scripts/lib/embeddings/embedding-factory.ts`): default changed from `ollama` → `local` (Python server). Falls back to HuggingFace API when `EMBEDDING_MODEL=huggingface`.
- **MCP server** (`mcp-server/tools/lib/embedding-provider.ts`): default changed from `ollama` → `local`; `huggingface` and `local` providers added; factory updated with new env vars (`HF_MODEL`, `HF_API_TOKEN`, `HF_DIMENSIONS`, `LOCAL_EMBED_URL`, `LOCAL_EMBED_DIMS`).
- Error messages in `semantic-search`, `get-feature-context`, and `find-template-file` updated to describe the new default provider and configuration options.

#### Infrastructure
- `scripts/lib/vector-store.ts`: LanceDB is now dynamically imported via `Function('return import(...)')()` to avoid ESM/CJS interop issues in Node environments.
- `mcp-server/tools/get-file-summary.ts`: path matching refactored to use shared `findSummary` helper, eliminating duplicated exact/suffix/extension matching logic.

---

## [0.2.0] - 2026-03-17

### Added

#### New MCP Tools
- **`semantic_search`** — Hybrid BM25 keyword + ANN vector search merged via Reciprocal Rank Fusion. Supports scoping to `files`, `symbols`, `features`, or `all`, with configurable `topK` (max 50). Results include relevance scores, snippets, and metadata.
- **`explore_graph`** — Traverses the knowledge graph from a start node following typed edges (`contains`, `calls`, `imports`, `depends_on`, `implements`, `similar_to`). Supports BFS depth up to 5 and `outgoing`/`incoming`/`both` direction modes.
- **`get_feature_context`** — Semantic feature group lookup. Finds the top-K feature clusters most relevant to a query, returning name, description, files, entry points, data flow, key symbols, and related features.

#### Build Pipeline Phases
- **Phase 7 — Embedding generation** (`scripts/lib/phases/embedding-phase.ts`): Reads summaries and symbols, generates embeddings via configurable provider, and upserts into `files.lance` and `symbols.lance`. Supports incremental updates keyed on `contentHash`.
- **Phase 8 — Knowledge graph construction** (`scripts/lib/phases/graph-build-phase.ts`): Builds a `KnowledgeGraph` from symbols, dependencies, and summaries; writes `graph/nodes.json` and `graph/edges.json` with deterministic, sorted output.
- **Phase 9 — Feature discovery** (`scripts/lib/phases/feature-discovery-phase.ts`): Clusters file embeddings, generates LLM-summarised feature groups, and writes `features/index.json` and `features/cache.json`. Controlled by `--skip-features` and `--rebuild-features` flags.

#### Embedding Providers
- `EmbeddingProvider` interface with factory (`scripts/lib/embeddings/embedding-factory.ts`)
- `OpenAIEmbeddingProvider` — uses OpenAI `text-embedding-3-small` by default
- `OllamaEmbeddingProvider` — local embeddings via Ollama REST API

#### Infrastructure
- **`VectorStore`** (`scripts/lib/vector-store.ts`) — LanceDB-backed vector storage for files and symbols.
- **`KnowledgeGraph`** (`mcp-server/tools/lib/knowledge-graph.ts`) — In-memory graph with BFS traversal and typed edge filtering.
- **`HybridRetriever`** (`mcp-server/tools/lib/hybrid-retriever.ts`) — Combines BM25 and ANN results via Reciprocal Rank Fusion.
- **`BM25Index`** (`mcp-server/tools/lib/bm25-index.ts`) — Pure-TypeScript BM25 index built from knowledge data.
- **`QueryRouter`** (`mcp-server/tools/lib/query-router.ts`) — Infers optimal search scope from query text.
- **`WorkingMemory`** (`mcp-server/tools/lib/working-memory.ts`) — Per-session LRU cache to avoid redundant tool calls.
- **`FeatureDiscovery`** (`scripts/lib/feature-discovery.ts`) — Clustering + LLM summarisation pipeline for feature group extraction.
- **`Clustering`** (`scripts/lib/clustering.ts`) — k-means clustering over embedding vectors.

#### New npm Scripts
- `build-knowledge:skip-vectors` — skip embedding generation phase
- `build-knowledge:skip-features` — skip feature discovery phase
- `build-knowledge:rebuild-features` — force-rebuild feature groups
- `build-knowledge:full` — full rich build (equivalent to `--richness rich`)

#### CI / GitHub Actions
- `release.yml` workflow — triggered on `v*.*.*` tags: runs tests, builds MCP server, creates a GitHub Release, and publishes to npm (with provenance, behind a manual approval gate).
- `ci.yml` workflow — continuous integration on PRs and pushes.

#### Tests
- New test suite covering: `EmbeddingProvider`, `VectorStore`, `BM25Index`, `HybridRetriever`, `KnowledgeGraph`, `ExploreGraph`, `SemanticSearch`, `GetFeatureContext`, `FindTemplateFile`, `FeatureDiscovery`, embedding phase, feature-discovery phase, and graph-build phase.

### Changed
- `mcp-server/server.ts` — registered `semantic_search`, `explore_graph`, and `get_feature_context` tools.
- `mcp-server/tools/find-template-file.ts` — updated to use new data-loader patterns.
- `mcp-server/tools/lib/data-loader.ts` — extended with `loadVectorStore`, `loadKnowledgeGraph`, `loadFeatureGroups`, and `buildBM25IndexFromKnowledge` helpers.
- `src/types.ts` / `mcp-server/types.ts` — new types: `SemanticSearchArgs`, `ExploreGraphArgs`, `FeatureGroup`, `GraphNode`, `GraphEdge`, and associated schemas.
- `.gitignore` — updated to exclude vector index artefacts (`*.lance/`, `graph/`, `features/`) and build outputs.
- `scripts/install-hooks.sh` — improved hook installation reliability.

---

## [0.1.0] - 2025-01-01

Initial release — AI Code Knowledge System with MCP server, symbol extraction, dependency mapping, file summarisation, and composite query tools (`get_project_overview`, `get_module_context`, `get_implementation_context`, `get_batch_summaries`, `find_symbol`, `find_callers`, `get_dependencies`, `search_architecture`).
