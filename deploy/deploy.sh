#!/usr/bin/env bash
# Pull, install, build, migrate, restart. Idempotent.
# Run from within the cloned repo as the application user.
#
#   cd /opt/command-dashboard
#   bash deploy/deploy.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_DIR"
WEB_ROOT="${WEB_ROOT:-/var/www/command-dashboard}"
SERVER_DIR="$APP_DIR/server"

echo "==> Pulling latest"
cd "$APP_DIR"
git fetch --all --prune
git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)

echo "==> Building frontend"
npm ci
npm run build

echo "==> Publishing build to $WEB_ROOT"
rm -rf "$WEB_ROOT.new"
mkdir -p "$WEB_ROOT.new"
cp -a "$APP_DIR/dist/." "$WEB_ROOT.new/"
# Atomic swap (rename current → .old, .new → current, then drop .old).
if [[ -d "$WEB_ROOT" ]]; then
    mv "$WEB_ROOT" "$WEB_ROOT.old"
fi
mv "$WEB_ROOT.new" "$WEB_ROOT"
rm -rf "$WEB_ROOT.old"

echo "==> Installing API dependencies"
cd "$SERVER_DIR"
npm ci

echo "==> Running database migrations"
npm run migrate

echo "==> Reloading PM2"
if pm2 jlist | grep -q '"name":"command-dashboard-api"'; then
    pm2 reload ecosystem.config.cjs
else
    pm2 start ecosystem.config.cjs --env production
    pm2 save
fi

echo "==> Reloading nginx"
sudo nginx -t && sudo systemctl reload nginx

echo "==> Deploy complete. Health check:"
curl -fsSL https://"${DOMAIN:-localhost}"/api/health || echo "(health check failed — investigate logs)"
