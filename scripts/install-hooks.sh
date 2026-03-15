#!/bin/sh
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
if [ -z "$GIT_DIR" ]; then
  echo "Error: not a git repository. Run this script from the project root."
  exit 1
fi
HOOK="$GIT_DIR/hooks/pre-commit"
printf '#!/bin/sh\nif [ -f scripts/build-knowledge.ts ]; then\n  npm run build-knowledge\n  git add .knowledge/\nfi\n' > "$HOOK"
chmod +x "$HOOK"
echo "Pre-commit hook installed at $HOOK"
