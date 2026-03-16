# Blocker: TASK-013 - Create Claude MCP integration configs

## Status: Security Restriction

The `.claude/` directory at `/Users/amangupta/Projects/AICoder/.claude/` is treated as a sensitive path by the Claude Code sandboxing environment. Direct writes to this directory are blocked.

## What Needs to Be Created

### 1. Create the directory:
```bash
mkdir -p /Users/amangupta/Projects/AICoder/.claude
```

### 2. Create `.claude/mcp_servers.json` (Production config):
```bash
cat > /Users/amangupta/Projects/AICoder/.claude/mcp_servers.json << 'EOF'
{
  "mcpServers": {
    "ai-code-knowledge": {
      "command": "node",
      "args": ["mcp-server/dist/server.js"],
      "env": {
        "KNOWLEDGE_ROOT": ".knowledge"
      }
    }
  }
}
EOF
```

### 3. Create `.claude/mcp_servers.dev.json` (Development config):
```bash
cat > /Users/amangupta/Projects/AICoder/.claude/mcp_servers.dev.json << 'EOF'
{
  "mcpServers": {
    "ai-code-knowledge": {
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

## Schema Explanation

Both files follow the Claude MCP configuration schema:
- `mcpServers`: Top-level key mapping server name to config
- `command`: The executable to run
- `args`: Array of arguments to pass to the command
- `env`: Environment variables to set (includes `KNOWLEDGE_ROOT` pointing to `.knowledge`)

**Production** (`mcp_servers.json`): Uses compiled `node mcp-server/dist/server.js` — requires `npm run build-mcp` first (TASK-014).

**Development** (`mcp_servers.dev.json`): Uses `npx tsx mcp-server/server.ts` for direct TypeScript execution without compilation.

## Resolution

Run the bash commands above in the project terminal (`/Users/amangupta/Projects/AICoder`) with appropriate permissions to create these files.
