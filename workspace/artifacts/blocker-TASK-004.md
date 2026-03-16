# Blocker: TASK-004 — Create .claude MCP Server Configuration Files

## Status
BLOCKED — Cannot write to `.claude/` directory due to sandbox security restrictions.

## Root Cause
Claude Code sandboxes writes to `.claude/` as a sensitive directory. All attempts to create or modify files under `/Users/amangupta/Projects/AICoder/.claude/` are rejected with:
> "Claude requested permissions to edit … which is a sensitive file."

## Intended File Contents

### `.claude/mcp_servers.json` (production config)
```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
```

### `.claude/mcp_servers.dev.json` (development config)
```json
{
  "mcpServers": {
    "knowledge": {
      "command": "npx",
      "args": ["tsx", "mcp-server/server.ts"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
```

## Resolution

A human operator must manually create these two files in the `.claude/` directory at the project root with the exact content shown above.

Steps:
```bash
# From the project root: /Users/amangupta/Projects/AICoder/
mkdir -p .claude

cat > .claude/mcp_servers.json << 'EOF'
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
EOF

cat > .claude/mcp_servers.dev.json << 'EOF'
{
  "mcpServers": {
    "knowledge": {
      "command": "npx",
      "args": ["tsx", "mcp-server/server.ts"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
EOF
```

## Notes
- Both files are valid JSON and follow the Claude Code MCP server configuration schema (`mcpServers.<name>.command/args/env`).
- The `KNOWLEDGE_ROOT` env var is set to `.knowledge` (relative to CWD when Claude Code launches the server subprocess).
- The production config uses `node mcp-server/dist/server.js` (compiled CommonJS output from `tsconfig.mcp.json`).
- The dev config uses `npx tsx mcp-server/server.ts` for fast iteration without a build step.
