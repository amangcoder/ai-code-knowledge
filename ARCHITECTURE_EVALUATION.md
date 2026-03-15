# Technical Evaluation: AI Code Knowledge System
**Evaluator Role:** Principal AI Infrastructure Engineer
**Date:** 2026-03-15
**Subject:** Proposed `.knowledge` + MCP architecture for reducing Claude Code token usage
**Source PRD:** `PRD.md`

> **Purpose of this document:** A machine-readable, agent-consumable technical evaluation. Downstream agents should treat Section 7 (Improvements) and Section 8 (Verdict) as authoritative design guidance for any implementation work.

---

## Table of Contents

1. [Feasibility Analysis](#1-feasibility-analysis)
2. [Token Efficiency Analysis](#2-token-efficiency-analysis)
3. [Workflow Evaluation](#3-workflow-evaluation)
4. [Failure Modes](#4-failure-modes)
5. [Missing Capabilities vs. Advanced Tools](#5-missing-capabilities-vs-advanced-tools)
6. [Architecture Improvements](#6-architecture-improvements)
7. [Complexity vs. Benefit](#7-complexity-vs-benefit)
8. [Final Verdict](#8-final-verdict)

---

## 1. Feasibility Analysis

### Overall Rating: Feasible with critical gaps

### What is technically sound

| Component | Assessment |
|---|---|
| MCP server integration | Fully supported. `@modelcontextprotocol/sdk` is stable. `.claude/mcp_servers.json` is the correct integration point. |
| `.knowledge/` directory layout | Trivial. Static files, no infra required. |
| Git pre-commit hook triggering regeneration | Standard. Works across all platforms with husky or native hooks. |
| `search_code` via ripgrep | Implementable. ripgrep is fast and widely available. |
| `get_file_summary` / `get_module_docs` | Simple file reads. No blockers. |

### Critical technical gaps

**Gap 1 — Contradiction in summary generation**

The PRD requires:
- Deterministic summaries (no LLM APIs)
- `Purpose` fields describing what a file does in plain English

These two requirements are mutually exclusive. Static analyzers (regex, AST parsing) can extract:
- Function signatures and names
- Import/export statements
- Class hierarchies

They **cannot** produce: `"Purpose: Handles order lifecycle operations"` — that requires either LLM inference or manual annotation. Any implementation that claims deterministic generation of Purpose fields is fabricating them from file names, which is unreliable.

**Gap 2 — `search_architecture` duplicates native capability**

This tool searches `.knowledge/` with text matching. Claude Code already has `grep` and `glob` as native tools. Wrapping ripgrep in an MCP tool adds:
- ~100–300ms process spawn latency
- An extra failure surface (MCP server must be running)
- No improvement in search quality

**Gap 3 — Claude Code tool-use is not deterministic**

Section 12 of the PRD states: "AI agents must follow these rules: Query MCP tools before scanning repository files." This is advisory, not enforced. Claude Code decides which tools to invoke based on context. If MCP tools return poor results twice, Claude Code will fall back to native `grep`/`read` — bypassing the entire system. There is no enforcement mechanism.

**Gap 4 — Update mechanism has a critical staleness window**

Pre-commit hooks fire once per commit. During active development (edit → test → edit → test cycles), summaries are stale for the entire development window. Claude Code operating on stale summaries during a live coding session will make incorrect decisions with high confidence.

### Integration complexity estimate

| Task | Effort |
|---|---|
| MCP server (4 tools) | 1–2 days |
| Knowledge generator (static extraction only) | 2–3 days |
| Git hook wiring | 0.5 days |
| CLAUDE.md instructions | 2 hours |
| Testing + edge cases | 3–5 days |
| **Total (static extraction only)** | **~2 weeks** |
| + LLM-assisted summaries | +1 week |
| + Symbol graph | +1–2 weeks |

---

## 2. Token Efficiency Analysis

### Methodology

A Claude Code session's token budget breaks down as follows:

| Bucket | % of Session Tokens | Reducible by this system? |
|---|---|---|
| Conversation history + reasoning | 35–50% | No |
| Full file reads (code writing/editing) | 25–40% | Minimally (still need files to write code) |
| Exploration (glob, grep, orientation) | 10–20% | Yes — this is the target |
| Tool call overhead | 5–10% | Neutral (MCP adds its own overhead) |

**The system can only affect the exploration bucket.** Token usage during active coding (reading files to understand context, writing code, reasoning about logic) is unchanged.

### 200-file repository

**Baseline (Claude Code default):**
```
Session orientation:          ~1,000 tokens
Glob/grep exploration:        ~1,500 tokens
Read 6–10 relevant files:     ~8,000–15,000 tokens
Code generation + reasoning:  ~18,000 tokens
─────────────────────────────────────────────
Total:                        ~28,500–35,500 tokens
```

**With .knowledge + MCP:**
```
search_architecture:          ~400 tokens
get_module_docs x2:           ~600 tokens
get_file_summary x4:          ~800 tokens
Still read 5–8 files:         ~6,000–12,000 tokens
Code generation + reasoning:  ~18,000 tokens
MCP schema overhead:          ~1,500 tokens
─────────────────────────────────────────────
Total:                        ~27,300–33,300 tokens
```

**Savings: 5–8%. Range: 2,000–5,000 tokens.**

At this scale, the savings do not justify the infrastructure.

---

### 1,000-file repository

**Baseline:**
```
Orientation (no guidance):    ~3,000 tokens
Glob/grep cycles (more misses): ~4,000 tokens
Read 12–20 files (wrong files included): ~18,000–30,000 tokens
Code generation + reasoning:  ~25,000 tokens
─────────────────────────────────────────────
Total:                        ~50,000–62,000 tokens
```

**With .knowledge + MCP:**
```
search_architecture:          ~500 tokens
get_module_docs x3:           ~900 tokens
get_file_summary x6:          ~1,200 tokens
Read 6–10 correctly targeted files: ~8,000–15,000 tokens
Code generation + reasoning:  ~25,000 tokens
MCP schema overhead:          ~2,000 tokens
─────────────────────────────────────────────
Total:                        ~37,600–44,600 tokens
```

**Savings: 25–35%. Range: 12,000–18,000 tokens.**

This is meaningful. For large repos, the system provides real value.

---

### 5,000-file repository

**Baseline:**
```
Orientation attempts:         ~8,000 tokens
Grep/glob cycles (high miss rate): ~10,000 tokens
Reading wrong + right files:  ~35,000–60,000 tokens
Code generation + reasoning:  ~30,000 tokens
─────────────────────────────────────────────
Total:                        ~83,000–108,000 tokens
```

**With .knowledge + MCP:**
```
search_architecture:          ~600 tokens
get_module_docs x4:           ~1,200 tokens
get_file_summary x8:          ~1,600 tokens
Read 6–10 targeted files:     ~9,000–15,000 tokens
Code generation + reasoning:  ~30,000 tokens
MCP schema overhead:          ~2,500 tokens
─────────────────────────────────────────────
Total:                        ~44,900–50,900 tokens
```

**Savings: 45–55%. Range: 38,000–57,000 tokens.**

At this scale, the system provides substantial value. The exploration overhead without guidance is very high in a 5,000-file repo.

---

### Summary table

| Repo size | Baseline tokens | With .knowledge | Savings | Savings % |
|---|---|---|---|---|
| 200 files | ~32,000 | ~30,000 | ~2,000 | 5–8% |
| 1,000 files | ~56,000 | ~41,000 | ~15,000 | 25–35% |
| 5,000 files | ~95,000 | ~48,000 | ~47,000 | 45–55% |

**The claimed 70–90% reduction is not achievable.** It implicitly assumes that all token usage is exploration, which is false. The real ceiling is ~55% for very large repositories with high-quality summaries.

---

## 3. Workflow Evaluation

### Code Review

**Helps:** Architecture overview and module docs give Claude Code context about what a PR is supposed to accomplish. Reduces need to read surrounding files for context.
**Fails:** Code review requires line-level understanding of the actual diff. Summaries do not contain this. Claude must still read the changed files in full.
**Net benefit: Low-Medium.** Orientation is faster; review quality unchanged.

---

### Unit Test Generation

**Helps:** `get_file_summary` returns exported functions, which are the target of unit tests. Claude Code can identify what to test without reading implementation details.
**Fails:** Good unit tests require understanding edge cases, error paths, and preconditions. These are not in summaries. A summary saying `createOrder(dto)` does not reveal that the function throws `OrderLimitExceeded` when count > 100 or that it silently skips analytics when `dto.testMode = true`.
**Net benefit: Low.** Useful for discovering what to test; harmful if Claude generates tests based only on the summary and misses critical branches.

---

### Debugging

**Helps:** None in typical cases.
**Fails significantly:** Debugging requires exact understanding of control flow, variable state, and edge cases. Summaries abstract this away. A summary saying `PaymentService.charge()` "processes payment" does not reveal the retry logic that causes a double-charge bug. Claude Code using summaries for debugging will confidently navigate to the wrong location.
**Net benefit: Negative.** The system may actively mislead Claude Code during debugging by providing confident but incomplete information.

---

### Feature Implementation

**Helps:** This is the strongest use case. Understanding module boundaries, key dependencies, and existing patterns before writing new code. `get_module_docs` and `search_architecture` directly serve this workflow.
**Fails:** Claude still needs full file reads for any file it will modify. Summaries reduce exploration overhead, not implementation overhead.
**Net benefit: Medium-High** for large repos where orientation is expensive.

---

### Large Refactoring

**Helps:** Understanding which modules are affected, what depends on what, and what the current architecture looks like. Module docs and architecture overview are genuinely valuable here.
**Fails:** Refactoring requires understanding every call site, every usage of the affected symbol, every test that exercises it. Text summaries do not provide call graphs or usage maps. Claude will miss call sites that don't appear in summaries.
**Net benefit: Low-Medium.** Helpful for planning; dangerous if used as a substitute for comprehensive call-graph analysis.

---

### Workflow Summary

| Task | Benefit | Risk level |
|---|---|---|
| Code review | Low-Medium | Low |
| Unit test generation | Low | Medium (incomplete test coverage) |
| Debugging | Negative | High (misleading context) |
| Feature implementation | Medium-High | Low-Medium |
| Large refactoring | Low-Medium | High (missing call sites) |

---

## 4. Failure Modes

### FM-1: Stale Summaries
**Severity: High**

Pre-commit hooks update `.knowledge/` once per commit. During active development, the gap between last commit and current file state can be hours or days. Claude Code receiving summaries that reflect a previous version of the code will:
- Reference functions that no longer exist
- Miss new dependencies added since last commit
- Apply patterns that have been refactored away

**Mitigation required:** File watcher with debouncing (chokidar or equivalent) for continuous updates during development sessions.

---

### FM-2: Misleading Purpose Descriptions
**Severity: High**

Without LLM generation, "Purpose" fields are either:
- Manually written (not scalable, becomes stale)
- Derived from file names (`order.service.ts` → "Service for orders")
- Absent

File-name-derived purposes are dangerously simplistic. `utils/helpers.ts` might contain critical business logic. `legacy/v1-compat.ts` might be actively used by 40% of the system. Claude Code trusting these purposes will make wrong architectural decisions with high confidence.

**Mitigation required:** Either LLM-assisted generation (even a local model) or explicit manual annotation with clear staleness warnings.

---

### FM-3: Claude Code Ignoring MCP Tools
**Severity: Medium**

Claude Code's tool selection is heuristic. If:
- MCP tools return low-confidence results
- MCP server is slow (>500ms)
- Native tools (grep, glob) appear more reliable

...Claude Code will fall back to native tools. This is invisible to the operator — there is no telemetry on tool selection. The system may be deployed and appear functional while Claude Code ignores it entirely.

**Mitigation required:** CLAUDE.md with explicit, strong instructions. Instrument MCP server to log tool call frequency. Alert if tool call rate drops below threshold.

---

### FM-4: Incorrect Dependency Assumptions
**Severity: Medium-High**

The dependency section of a summary lists what a file imports. This is extractable via static analysis. However:
- Dynamic imports (`import(path)`) are invisible
- Dependency injection (DI containers) makes runtime dependencies opaque
- Re-exports create transitive dependencies invisible in direct imports
- Monorepo workspace packages may not be detected

Claude Code trusting dependency lists for impact analysis in refactoring will miss affected files. For a large refactoring task, missing 3–4 affected files can break production.

**Mitigation required:** Use actual module bundler/resolver logic (ts-morph project references, webpack/esbuild dependency extraction) rather than regex import scanning.

---

### FM-5: Summary Oversimplification
**Severity: Medium**

A summary saying:
```
Exports: createOrder, confirmOrder, cancelOrder
```
...tells Claude nothing about:
- Which combinations are valid (can you cancel a confirmed order?)
- What errors each function raises
- What side effects occur (emails, webhooks, audit logs)
- What the performance characteristics are (createOrder is O(n) on cart size)
- What the concurrency model is (cancelOrder has a mutex, others don't)

Code generated from summaries alone will be functionally incomplete for non-trivial logic.

**Mitigation required:** Summaries must include error types, notable side effects, and concurrency notes. This requires LLM generation or manual annotation — neither is "deterministic."

---

### FM-6: MCP Server as Single Point of Failure
**Severity: Low** (graceful degradation exists)

If the MCP server crashes, Claude Code falls back to native tools. However:
- Operators may not notice the fallback
- Token usage reverts to baseline without warning
- If operators are monitoring cost based on expected savings, unexpected spikes occur silently

**Mitigation required:** Health check endpoint. CLAUDE.md fallback instructions. Cost monitoring alert.

---

## 5. Missing Capabilities vs. Advanced Tools

### Comparison with production AI developer tools

| Capability | This System | Sourcegraph Cody | Augment | Devin |
|---|---|---|---|---|
| Text search in docs | Yes | Yes | Yes | Yes |
| File summaries | Yes (static) | Yes (LLM) | Yes (LLM) | Yes (LLM) |
| Symbol graph | No | Yes | Yes | Yes |
| Call-chain tracing | No | Yes | Yes | Yes |
| AST indexing | No | Yes (tree-sitter) | Yes | Yes |
| Dependency graph | No | Yes | Yes | Yes |
| Semantic search | No | Yes (embeddings) | Yes | Yes |
| PR/diff awareness | No | Yes | Yes | Yes |
| Cross-repo search | No | Yes | Partial | Yes |
| Test coverage mapping | No | Partial | Partial | Yes |

### Which missing capabilities are critical?

**Symbol graph — Critical for refactoring and debugging**
Without a symbol graph, "find all callers of `PaymentService.charge`" requires grep, which misses dynamic invocations, aliased imports, and interface polymorphism. Sourcegraph solves this with precise code intelligence. A local equivalent is achievable with `ts-morph` (TypeScript) or `tree-sitter` (multi-language).

**Dependency graph — Critical for impact analysis**
Understanding what breaks when you change an interface requires the full module dependency graph, not per-file dependency lists. Tools like `dependency-cruiser` or `madge` generate this as a static artifact. This is achievable without LLMs.

**Semantic search — High value, significant cost**
Text search on summaries fails for queries like "how does authentication work?" when the answer is spread across files using terms like "identity," "JWT," "session," and "claims." Semantic search with embeddings (even a local model like `all-MiniLM-L6-v2`) bridges this gap. The PRD explicitly rejects this for cost reasons, but a local model has zero per-query cost after the embedding build step.

**PR/diff awareness — High value for code review workflows**
The system has no concept of what changed recently. For code review, understanding "what is new/modified in this PR" is the primary task. No tool in the current design addresses this.

---

## 6. Architecture Improvements

### Improvement 1: Replace prose summaries with symbol graph (High impact, Feasible)

**Current state:** Prose summaries with export names.
**Proposed:** Structured symbol graph.

```json
{
  "OrderService.createOrder": {
    "file": "src/orders/order.service.ts",
    "line": 47,
    "signature": "(dto: CreateOrderDto) => Promise<Order>",
    "calls": ["PaymentService.charge", "OrderRepository.save", "AnalyticsService.track"],
    "calledBy": ["OrderController.createOrder", "BulkOrderService.processBatch"],
    "throws": ["OrderLimitExceeded", "PaymentDeclined"],
    "sideEffects": ["sends_email", "creates_audit_log"]
  }
}
```

**Tools:** `ts-morph` for TypeScript, `tree-sitter` for multi-language.
**Cost:** 1–2 weeks to implement. Zero per-query cost.
**Impact:** Enables precise `find_callers`, `find_usages`, impact analysis. Removes the need for grep-based exploration entirely for typed codebases.

---

### Improvement 2: Add module dependency graph (High impact, Feasible)

**Current state:** Per-file dependency lists (direct imports only).
**Proposed:** Pre-computed module-level and file-level dependency graph.

```json
{
  "nodes": ["orders", "payments", "analytics", "notifications"],
  "edges": [
    {"from": "orders", "to": "payments", "type": "direct"},
    {"from": "orders", "to": "analytics", "type": "optional"},
    {"from": "payments", "to": "notifications", "type": "event"}
  ],
  "cycles": [],
  "critical_paths": ["orders → payments → stripe-client"]
}
```

**Tools:** `dependency-cruiser`, `madge`, or custom ts-morph traversal.
**Cost:** 2–3 days.
**Impact:** Enables accurate impact analysis for refactoring. Claude Code can answer "what breaks if I change the Payment interface?" without reading 50 files.

---

### Improvement 3: Continuous file watcher for summaries (High impact, Low cost)

**Current state:** Pre-commit hook only.
**Proposed:** Background file watcher that updates summaries within 2 seconds of file save.

```typescript
// Pseudocode
chokidar.watch('src/', { ignoreInitial: true })
  .on('change', debounce(async (path) => {
    const summary = await generateSummary(path);
    await writeSummary(path, summary);
    await updateIndex();
  }, 500));
```

**Cost:** 1 day.
**Impact:** Eliminates the staleness window during active development. This is a blocking issue without which the system provides incorrect information during the sessions where it matters most.

---

### Improvement 4: Add new MCP tool `find_symbol` (High impact, Feasible)

Replace the text-search `search_code` tool with a symbol-aware lookup:

```typescript
find_symbol(name: string): SymbolResult[]
find_callers(symbol: string): CallSite[]
find_implementations(interface: string): Implementation[]
get_dependencies(module: string, depth?: number): DependencyGraph
```

These are O(1) lookups against the pre-built symbol graph. Sub-10ms latency. Far more useful than ripgrep text search for typed codebases.

---

### Improvement 5: Optional local embedding model for semantic search (Medium impact, Moderate cost)

The PRD rejects embeddings for cost reasons. However:

- `all-MiniLM-L6-v2` runs locally in ~200MB RAM
- Embedding generation: ~0.5ms per file after initial index build
- Zero per-query API cost
- Enables: "find code related to rate limiting" returning throttle.ts, circuit-breaker.ts, backpressure.ts even if they don't use the phrase "rate limiting"

**Recommended approach:** Make this opt-in via config flag. Teams without the capability skip it; teams with the need enable it.

---

### Improvement 6: LLM-assisted summary generation (Medium impact, Moderate cost)

The "Purpose" field problem requires either manual annotation or LLM assistance. Use a cheap, fast model (e.g., `claude-haiku-4-5`) to generate summaries once at index build time. Cache them. Only regenerate when files change.

Cost estimate: 5,000 files × 300 tokens/file = 1.5M tokens = ~$0.23 per full rebuild. Negligible.

This resolves the fundamental contradiction in the PRD.

---

### Recommended revised architecture

```
repo/
├─ src/
├─ .knowledge/
│   ├─ architecture.md          ← human-written or LLM-assisted
│   ├─ symbols.json             ← symbol graph (ts-morph/tree-sitter)
│   ├─ dependencies.json        ← module dependency graph
│   ├─ summaries/               ← LLM-assisted, cached
│   └─ index.json
├─ scripts/
│   ├─ build-symbols.ts         ← deterministic, fast (<5s for 1000 files)
│   ├─ build-docs.ts            ← LLM-assisted, cached
│   └─ watch.ts                 ← continuous file watcher
└─ mcp-server/
    server.ts
    tools:
      find_symbol(name)
      find_callers(symbol)
      get_dependencies(module, depth)
      get_file_summary(file)
      search_architecture(query)
```

**Drop:** `search_code` (native grep is better), `get_module_docs` (merge into `get_dependencies`).
**Add:** `find_symbol`, `find_callers`, `get_dependencies`.

---

## 7. Complexity vs. Benefit

### Cost of building this system

| Component | Engineering effort |
|---|---|
| MCP server (4 tools) | 2–3 days |
| Static symbol extractor (ts-morph) | 3–5 days |
| Dependency graph builder | 2–3 days |
| Continuous file watcher | 1 day |
| Git hooks + CI integration | 1 day |
| CLAUDE.md instructions + testing | 2–3 days |
| LLM-assisted summaries (optional) | 2–3 days |
| **Total** | **~3–4 weeks** |

### Benefit vs. simpler alternatives

**Option A: Well-written CLAUDE.md only**
- Effort: 4–8 hours
- Token savings: ~15–25% (orientation benefit)
- Covers: Architecture overview, module map, key file locations, coding patterns
- Missing: Dynamic queries, call graphs, automated updates

**Option B: CLAUDE.md + custom slash commands**
- Effort: 1–2 days
- Token savings: ~20–30%
- Covers: Targeted searches, pattern lookups
- Missing: Automated regeneration, dependency graphs

**Option C: This system (as proposed in PRD)**
- Effort: ~2 weeks
- Token savings: 5–15% (small repos), 25–35% (large repos)
- Missing: Symbol graph, call chains, semantic search, continuous updates

**Option D: This system with recommended improvements**
- Effort: ~3–4 weeks
- Token savings: 30–55% (large repos)
- Covers: Symbol graph, dependency graph, continuous updates

### Decision framework

| Repo size | Recommendation |
|---|---|
| < 200 files | CLAUDE.md only. This system is overengineered. |
| 200–500 files | CLAUDE.md + selective file loading. Marginal benefit from this system. |
| 500–2,000 files | This system (with improvements) provides meaningful ROI. |
| 2,000+ files | This system is necessary. Without it, Claude Code's exploration overhead dominates cost. |

---

## 8. Final Verdict

### Classification: **2 — Promising but requires significant improvements**

### Rationale

**The core insight is correct.** For large repositories, exploration overhead is a real problem. A structured knowledge layer with MCP tools is the right architectural approach. MCP is the correct integration mechanism. The `.knowledge` directory as a static artifact is the right design (no vector DB, no cloud dependency).

**The claimed 70–90% reduction is not achievable with the current design.** Realistic savings:
- 5–8% for small repos (< 200 files) — not worth building
- 25–35% for medium repos (500–1,000 files) — borderline
- 45–55% for large repos (2,000–5,000 files) — clearly worthwhile

**The current design has three blocking problems:**
1. Deterministic summaries without LLMs cannot produce meaningful "Purpose" fields
2. Pre-commit-only updates mean stale knowledge during active development
3. Text-based search tools duplicate native capabilities without improvement

**The system becomes significantly more valuable with:**
1. Symbol graph via ts-morph/tree-sitter (deterministic, high precision)
2. Module dependency graph via dependency-cruiser (deterministic, high value)
3. Continuous file watcher for real-time updates
4. LLM-assisted summary generation (cached, cheap, solves the Purpose field problem)
5. New tools: `find_symbol`, `find_callers`, `get_dependencies`

### Build/skip recommendation

**Build if:**
- Target repo is 500+ files and growing
- Team uses Claude Code heavily (5+ sessions/day)
- You implement the symbol graph and dependency graph, not just text summaries
- You add continuous file watching, not just pre-commit hooks

**Skip/defer if:**
- Repo is under 300 files
- Team uses Claude Code occasionally
- You have not yet written a thorough CLAUDE.md (do that first — highest ROI, lowest cost)

### Minimum viable version recommendation

If building: start with CLAUDE.md + symbol graph + dependency graph exposed via 3 MCP tools (`find_symbol`, `find_callers`, `get_dependencies`). Skip prose summaries until you have LLM generation implemented. This delivers 80% of the value at 40% of the effort.

---

## Appendix A: Token Estimation Methodology

All token estimates use the following assumptions:
- Average source file: 150–250 lines ≈ 1,200–2,000 tokens
- Average summary: 80–150 tokens
- Average module doc: 200–350 tokens
- MCP tool schema overhead: ~400 tokens per tool available
- Conversation + reasoning: ~20,000–30,000 tokens per session (held constant)
- Model: Claude Sonnet 4.6

These estimates reflect mid-complexity sessions (feature implementation, moderate codebase familiarity). Debugging sessions skew higher on file reads; architecture review sessions skew higher on exploration.

## Appendix B: Suggested MCP Tool Signatures

```typescript
// Symbol lookup
find_symbol(name: string, type?: 'function' | 'class' | 'interface' | 'type'): {
  file: string;
  line: number;
  signature: string;
  module: string;
}[]

// Call graph
find_callers(symbol: string, maxDepth?: number): {
  caller: string;
  file: string;
  line: number;
  callChain: string[];
}[]

// Dependency graph
get_dependencies(module: string, depth?: number): {
  direct: string[];
  transitive: string[];
  graph: { from: string; to: string; type: string }[];
}

// File summary (kept from original design)
get_file_summary(file: string): {
  purpose: string;
  exports: string[];
  dependencies: string[];
  sideEffects: string[];
  throws: string[];
}

// Architecture search (kept, but Claude can grep .knowledge/ directly)
search_architecture(query: string): string  // returns relevant excerpts
```

## Appendix C: Alternatives Considered and Rejected

| Alternative | Reason rejected |
|---|---|
| Vector database (Pinecone, Weaviate) | Operational overhead, per-query cost, external dependency |
| Full LLM-based indexing on every change | Too slow for pre-commit (would take 30–120s per rebuild) |
| Language server protocol (LSP) integration | Requires live language server process; complex to wire to MCP |
| ctags/etags | No semantic understanding; too shallow for modern codebases |
| Sourcegraph self-hosted | Valid alternative, but high operational cost and complexity for small teams |

The recommended architecture (symbol graph + dependency graph + LLM-cached summaries) hits the optimal point: deterministic where possible, LLM-assisted only where necessary, zero per-query cost, no external services required.
