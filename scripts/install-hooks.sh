#!/bin/sh
HOOK=".git/hooks/pre-commit"
echo '#!/bin/sh\nnpm run build-knowledge\ngit add .knowledge/' > $HOOK
chmod +x $HOOK
echo "Pre-commit hook installed at $HOOK"
