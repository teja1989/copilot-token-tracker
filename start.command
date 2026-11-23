#!/usr/bin/env bash
# Double-click this file on macOS (or run ./start.command in Terminal)
# to launch the AgentPulse interactive menu with zero typing!

set -e
cd "$(dirname "$0")"

# Find a working Node.js >= 20 binary (handles Homebrew versioned installs & nvm gracefully)
find_node() {
  local candidates=(
    "$(command -v node 2>/dev/null || true)"
    "/opt/homebrew/opt/node@24/bin/node"
    "/opt/homebrew/opt/node@22/bin/node"
    "/opt/homebrew/opt/node@20/bin/node"
    "/usr/local/bin/node"
  )
  for bin in "${candidates[@]}"; do
    if [[ -n "$bin" && -x "$bin" ]]; then
      if "$bin" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" 2>/dev/null; then
        export PATH="$(dirname "$bin"):$PATH"
        echo "$bin"
        return 0
      fi
    fi
  done
  return 1
}

NODE_BIN="$(find_node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo ""
  echo "  ✖ Could not find a working Node.js v20+ installation."
  echo "    Please install Node.js 20+ from https://nodejs.org/ and double-click again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

"$NODE_BIN" scripts/launch.mjs
