Product Requirements Document

Project: AI Code Knowledge System

Purpose:
Build a system that allows AI coding agents (e.g., Claude Code) to understand a codebase without scanning the entire repository. The system will generate structured knowledge summaries and expose them via MCP tools.

Primary goal:

Reduce AI token usage and repo scanning by 70–90%.

1. System Overview

The system consists of three main components:

Knowledge Generator

Knowledge Storage

MCP Tool Server

Architecture:

Repository
   │
   ├─ Knowledge Generator
   │      scans code
   │      creates summaries
   │
   ├─ .knowledge folder
   │      stores structured docs
   │
   └─ MCP Server
         exposes tools for AI agents

AI agents query MCP tools instead of scanning the repository.

2. Core Functional Requirements

The system must:

Scan repository source files

Generate structured summaries

Store summaries in .knowledge

Provide search tools through MCP

Update knowledge automatically when code changes

3. Repository Structure

Expected project structure:

repo/
│
├─ src/
│
├─ .knowledge/
│   ├─ architecture.md
│   ├─ modules/
│   ├─ summaries/
│   └─ index.json
│
├─ scripts/
│   build-knowledge.ts
│
└─ mcp-server/
    server.ts
4. Knowledge Generator

Component responsible for scanning code and generating summaries.

Location:

scripts/build-knowledge.ts

Responsibilities:

Scan repository files

Extract code structure

Generate summaries

Store summaries

Supported file types:

.ts
.js
.py
.go
.rs

Output format example:

File: order.service.ts

Purpose:
Handles order lifecycle operations.

Exports:
createOrder
confirmOrder
cancelOrder

Dependencies:
PaymentService
AnalyticsService
OrderRepository

Store output in:

.knowledge/summaries/
5. Module Documentation

For each major module, generate documentation.

Example:

.knowledge/modules/orders.md

Content structure:

Module: Orders

Purpose:
Manages order lifecycle.

Key files:
order.controller.ts
order.service.ts
order.repository.ts

Key operations:
createOrder
cancelOrder
confirmOrder
6. Architecture Documentation

Create:

.knowledge/architecture.md

Content includes:

• system modules
• service relationships
• high-level workflows

Example:

Order Flow

QR Scan
→ fetchMenu
→ createOrder
→ confirmOrder
→ notifyKitchen
7. MCP Server

Create MCP server exposing tools to AI agents.

Location:

mcp-server/server.ts

Use:

@modelcontextprotocol/sdk

The server must implement the following tools.

Tool 1: search_architecture

Purpose:

Search architecture and documentation files.

Input:

query: string

Search target:

.knowledge/

Output:

Relevant documentation excerpts.

Tool 2: search_code

Purpose:

Search source files for keywords.

Input:

query: string

Implementation:

Use ripgrep to search the repository.

Output:

File paths and matching lines.

Tool 3: get_file_summary

Purpose:

Return summary for a specific file.

Input:

file: string

Output:

Content of .knowledge/summaries/{file}.md

Tool 4: get_module_docs

Purpose:

Return documentation for a module.

Input:

module: string

Output:

Content of .knowledge/modules/{module}.md

8. Knowledge Index

Create index file:

.knowledge/index.json

Example:

{
  "modules": [
    "orders",
    "payments",
    "analytics"
  ],
  "summaries": [
    "order.service.ts",
    "payment.service.ts"
  ]
}

Used by MCP tools to locate documents.

9. Knowledge Update Mechanism

System must regenerate knowledge when code changes.

Two mechanisms:

Option A (recommended)

Git hook.

pre-commit

Runs:

npm run build-knowledge
Option B

Manual command:

npm run build-knowledge
10. Performance Requirements

Knowledge generation must:

• process 500 files in < 10 seconds
• not use any external LLM APIs

Search tools must return results in < 200 ms.

11. Claude Integration

Add MCP server configuration.

Location:

.claude/mcp_servers.json

Example:

{
 "servers": {
   "repo-tools": {
     "command": "node",
     "args": ["mcp-server/server.js"]
   }
 }
}

Claude Code will automatically detect and use these tools.

12. Agent Instructions

When interacting with this repository, AI agents must follow these rules:

Query MCP tools before scanning repository files.

Use summaries when available.

Only open source files if summaries are insufficient.

Preferred tool order:

search_architecture
get_module_docs
get_file_summary
search_code
13. Success Metrics

The system will be considered successful if:

• AI agents require fewer repository scans
• token usage decreases by at least 70%
• context retrieval time < 1 second

14. Future Enhancements

Possible improvements:

• AST-based code graph
• dependency graph generation
• semantic embeddings search
• automated workflow detection