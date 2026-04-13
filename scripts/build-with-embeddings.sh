#!/usr/bin/env bash
# Starts the local embedding server, runs build-knowledge, then shuts the server down.
#
# Usage:
#   bash scripts/build-with-embeddings.sh [--root <path>] [--gpu] [--port <port>] [--full]
#
# Options:
#   --root <path>   Project root to index (default: current directory)
#   --gpu           Use MPS/GPU acceleration (Apple Silicon)
#   --port <port>   Embedding server port (default: 8484)
#   --full          Rich summarization mode

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[build]${NC} $1"; }
warn()  { echo -e "${YELLOW}[build]${NC} $1"; }
error() { echo -e "${RED}[build]${NC} $1"; }

# ── Parse args ────────────────────────────────────────────────────────────────
PROJECT_ROOT=""
DEVICE="cpu"
PORT=8484
EXTRA_FLAGS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)   PROJECT_ROOT="$2"; shift 2 ;;
    --gpu)    DEVICE="mps"; shift ;;
    --port)   PORT="$2"; shift 2 ;;
    --full)   EXTRA_FLAGS="--richness rich"; shift ;;
    *)        shift ;;
  esac
done

# ── Check Python ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  error "python3 not found. Install Python 3 and run: pip3 install -r scripts/requirements.txt"
  exit 1
fi

# ── Start embedding server in background ──────────────────────────────────────
info "Starting embedding server on port $PORT (device: $DEVICE)..."
python3 scripts/embedding-server.py --port "$PORT" --device "$DEVICE" &
EMBED_PID=$!

# Ensure server is killed when this script exits (success or failure)
cleanup() {
  if kill -0 "$EMBED_PID" 2>/dev/null; then
    info "Stopping embedding server (pid $EMBED_PID)..."
    kill "$EMBED_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Wait for server to be ready ───────────────────────────────────────────────
info "Waiting for embedding server to be ready..."
MAX_WAIT=60
WAITED=0
until curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; do
  if ! kill -0 "$EMBED_PID" 2>/dev/null; then
    error "Embedding server crashed on startup. Check Python deps: pip3 install -r scripts/requirements.txt"
    exit 1
  fi
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    error "Embedding server did not start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
info "Embedding server ready."

# ── Build knowledge ───────────────────────────────────────────────────────────
BUILD_CMD="tsx scripts/build-knowledge.ts $EXTRA_FLAGS"
if [ -n "$PROJECT_ROOT" ]; then
  BUILD_CMD="$BUILD_CMD --root $PROJECT_ROOT"
fi

info "Building knowledge base..."
EMBEDDING_MODEL=local LOCAL_EMBED_URL="http://localhost:${PORT}" $BUILD_CMD

info "Done. Vectors and knowledge index are up to date."
