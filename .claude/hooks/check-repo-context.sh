#!/usr/bin/env bash
# Block any Edit/Write/Bash mutation if the resolved cwd contains "Desktop/rentthis"
# while session is operating on ServiceOS files. Prevents the bc1f91e-style accident.

set -euo pipefail

# Read JSON from stdin
input=$(cat)

# Extract cwd from tool_input if present, else use $PWD
cwd=$(echo "$input" | grep -oE '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "$PWD")

# If cwd contains rentthis but we appear to be in a ServiceOS session, block
if echo "$cwd" | grep -q "Desktop/rentthis"; then
  echo "BLOCKED: cwd resolves to ~/Desktop/rentthis (RentThis marketplace repo)." >&2
  echo "ServiceOS work must run in ~/serviceos. Run 'cd ~/serviceos' first." >&2
  echo "If you intentionally meant to work in RentThis, exit Claude Code and start a fresh session there." >&2
  exit 2
fi

exit 0
