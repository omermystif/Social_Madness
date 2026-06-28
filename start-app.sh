#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d node_modules ]]; then
  echo "Root dependencies are missing. Run npm install first."
  exit 1
fi

if [[ ! -d server/node_modules ]]; then
  echo "Server dependencies are missing. Installing them now..."
  (cd server && npm install)
fi

npm run build
(cd server && npm run migrate && npm run start)
