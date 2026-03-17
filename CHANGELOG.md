# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
