#!/usr/bin/env bash
# Daily backup. Run via cron: 0 3 * * * /opt/command-dashboard/deploy/backup.sh
# Keeps last 30 daily snapshots compressed.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/command-dashboard}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if [[ -n "${DATABASE_URL:-}" ]]; then
    # Postgres
    echo "==> pg_dump → $BACKUP_DIR/db-$STAMP.sql.gz"
    PGPASSWORD="$(printf '%s' "$DATABASE_URL" | sed -nE 's|.*://[^:]+:([^@]+)@.*|\1|p')" \
    pg_dump --no-owner --no-privileges --clean --if-exists \
            "$DATABASE_URL" | gzip -9 > "$BACKUP_DIR/db-$STAMP.sql.gz"
elif [[ -f "${DB_PATH:-/var/lib/command-dashboard/dashboard.db}" ]]; then
    # SQLite — use VACUUM INTO for a consistent copy.
    DB_PATH="${DB_PATH:-/var/lib/command-dashboard/dashboard.db}"
    OUT="$BACKUP_DIR/db-$STAMP.sqlite"
    echo "==> SQLite snapshot → $OUT.gz"
    sqlite3 "$DB_PATH" "VACUUM INTO '$OUT';"
    gzip -9 "$OUT"
else
    echo "No DATABASE_URL set and no SQLite file at \$DB_PATH. Nothing to back up."
    exit 1
fi

# Prune older than retention.
find "$BACKUP_DIR" -type f -name 'db-*' -mtime "+$RETENTION_DAYS" -delete
echo "==> Backup complete. Retained:"
ls -lh "$BACKUP_DIR" | tail -n 10
