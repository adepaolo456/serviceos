#!/usr/bin/env bash
# Block 'vercel --prod' if invoked from web/ directory.
# Web auto-deploys via git push. Manual web deploys break Sentry release pinning
# and were the root cause of the Apr 14 rootDirectory:"api" incident.

set -euo pipefail

input=$(cat)
command=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

# Only act on vercel --prod commands
if ! echo "$command" | grep -qE 'vercel[[:space:]].*--prod'; then
  exit 0
fi

# If running from web/ or the command targets web — block
cwd=$(pwd)
if echo "$cwd" | grep -qE '/web($|/)'; then
  echo "BLOCKED: 'vercel --prod' from web/ directory is forbidden." >&2
  echo "Web auto-deploys on git push. Manual deploys break Sentry release pinning." >&2
  echo "If deploying API: cd ~/serviceos/api && vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=\$(git rev-parse HEAD)" >&2
  exit 2
fi

# If --build-env VERCEL_GIT_COMMIT_SHA is missing for API deploys — warn (don't block)
if echo "$cwd" | grep -qE '/api($|/)'; then
  if ! echo "$command" | grep -q "VERCEL_GIT_COMMIT_SHA"; then
    echo "WARNING: vercel --prod without --build-env VERCEL_GIT_COMMIT_SHA=\$(git rev-parse HEAD)" >&2
    echo "Sentry release will fall back to cli-deploy-<UTC-ts>-no-sha. Continuing in 3s..." >&2
    sleep 3
  fi
fi

exit 0
