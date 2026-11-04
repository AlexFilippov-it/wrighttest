#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NODE_BIN=${WRIGHTTEST_NODE_PATH:-$(command -v node || true)}

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  printf '%s\n' 'Set WRIGHTTEST_NODE_PATH to an executable Node.js 20+ binary.' >&2
  exit 1
fi

if [ -z "${WRIGHTTEST_URL:-}" ]; then
  printf '%s\n' 'Set WRIGHTTEST_URL to the local WrightTest backend URL.' >&2
  exit 1
fi

API_TOKEN=$(/usr/bin/security find-generic-password \
  -a "$(id -un)" \
  -s 'wrighttest-mcp' \
  -w 2>/dev/null) || {
    printf '%s\n' 'No WrightTest MCP token found in macOS Keychain.' >&2
    exit 1
  }

if [ -z "$API_TOKEN" ]; then
  printf '%s\n' 'The WrightTest MCP Keychain item is empty.' >&2
  exit 1
fi

export WRIGHTTEST_API_TOKEN=$API_TOKEN
unset API_TOKEN
exec "$NODE_BIN" "$REPO_ROOT/mcp-server/dist/index.js"
