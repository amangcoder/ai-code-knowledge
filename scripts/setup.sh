#!/usr/bin/env bash
# One-command setup for ai-code-knowledge.
# Usage: bash scripts/setup.sh [--with-embeddings]
#
# Default:  installs deps, builds knowledge (static), builds MCP server.
# --with-embeddings: also installs Python deps and starts the local embedding server.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $1"; }

WITH_EMBEDDINGS=false
for arg in "$@"; do
  case "$arg" in
    --with-embeddings) WITH_EMBEDDINGS=true ;;
  esac
done

# ── Node dependencies ────────────────────────────────────────────────────────
if command -v pnpm &>/dev/null; then
  PKG=pnpm
elif command -v npm &>/dev/null; then
  PKG=npm
else
  echo "Error: pnpm or npm is required." >&2
  exit 1
fi

info "Installing dependencies with $PKG..."
$PKG install

# ── Knowledge base ───────────────────────────────────────────────────────────
info "Building knowledge base (static summarizer, no API keys needed)..."
$PKG run build-knowledge:skip-vectors

# ── MCP server ───────────────────────────────────────────────────────────────
info "Building MCP server..."
$PKG run build-mcp

# ── Optional: local embedding server ─────────────────────────────────────────
if [ "$WITH_EMBEDDINGS" = true ]; then
  info "Setting up local embedding server..."

  if ! command -v python3 &>/dev/null; then
    warn "Python 3 not found — skipping embedding server setup."
    warn "Install Python 3 and run: pip3 install -r scripts/requirements.txt"
  else
    info "Installing Python dependencies..."
    pip3 install -r scripts/requirements.txt

    # Start embedding server in background, wait for it, rebuild, then shut it down
    info "Starting embedding server..."
    python3 scripts/embedding-server.py &
    EMBED_PID=$!

    cleanup() {
      if kill -0 "$EMBED_PID" 2>/dev/null; then
        info "Stopping embedding server..."
        kill "$EMBED_PID" 2>/dev/null || true
      fi
    }
    trap cleanup EXIT

    info "Waiting for embedding server to be ready..."
    MAX_WAIT=60
    WAITED=0
    until curl -sf "http://localhost:8484/health" > /dev/null 2>&1; do
      if ! kill -0 "$EMBED_PID" 2>/dev/null; then
        warn "Embedding server crashed — skipping vector build."
        trap - EXIT
        break
      fi
      if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        warn "Embedding server did not start in time — skipping vector build."
        kill "$EMBED_PID" 2>/dev/null || true
        trap - EXIT
        break
      fi
      sleep 1
      WAITED=$((WAITED + 1))
    done

    if curl -sf "http://localhost:8484/health" > /dev/null 2>&1; then
      info "Rebuilding knowledge base with vectors..."
      EMBEDDING_MODEL=local $PKG run build-knowledge
    fi

    info "To start the embedding server later, run:"
    echo "  $PKG run start-embedding-server"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
info "Setup complete!"
echo ""
echo "  Start the MCP server:  $PKG run start-mcp"
echo "  Watch for changes:     $PKG run watch"
echo ""
echo "  Point it at another project:"
echo "    $PKG run build-knowledge -- --root /path/to/project"
echo "    KNOWLEDGE_ROOT=/path/to/project/.knowledge $PKG run start-mcp"
echo ""
