#!/usr/bin/env bash
set -euo pipefail

FILE="${1:?Usage: ./restore-app.sh server/backup/<file>.db.gz}"

cp server/taskmanager.db "server/taskmanager.db.bak.$(date +%s)" 2>/dev/null || true
gunzip -c "$FILE" > server/taskmanager.db
echo "Restore complete."
