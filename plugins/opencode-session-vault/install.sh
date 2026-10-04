#!/usr/bin/env sh
set -eu
TASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Instala Node.js 22.6 o posterior desde https://nodejs.org/ y vuelve a intentar."
  exit 1
fi
node "$TASK_DIR/dist/install.mjs" "$@"
