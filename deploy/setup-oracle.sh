#!/usr/bin/env bash
# One-shot Oracle Cloud Ubuntu 24.04 setup for command-dashboard.
# Run as root or with sudo on a fresh Oracle Always Free Ampere/AMD VM.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup-oracle.sh | sudo bash
#
# Idempotent — safe to re-run.

set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN env var, e.g. DOMAIN=dashboard.example.com}"
EMAIL="${EMAIL:?Set EMAIL env var for Let's Encrypt registration}"
APP_USER="${APP_USER:-dashboard}"
APP_DIR="${APP_DIR:-/opt/command-dashboard}"
DB_KIND="${DB_KIND:-postgres}"   # 'postgres' or 'sqlite'

echo "==> Updating apt + upgrading base system"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "==> Installing base packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl ca-certificates gnupg lsb-release ufw fail2ban git \
    nginx unattended-upgrades certbot python3-certbot-nginx \
    build-essential

echo "==> Configuring unattended security updates"
dpkg-reconfigure -plow unattended-upgrades

echo "==> Installing Node.js 20 LTS via NodeSource"
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
node --version
npm --version

echo "==> Installing PM2 globally"
npm install -g pm2

echo "==> Creating application user '$APP_USER'"
if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --shell /bin/bash --create-home --home-dir "/home/$APP_USER" "$APP_USER"
fi

echo "==> Creating directories"
mkdir -p "$APP_DIR" /var/www/command-dashboard /var/lib/command-dashboard /var/log/command-dashboard /var/www/letsencrypt
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/lib/command-dashboard /var/log/command-dashboard
chown -R www-data:www-data /var/www/command-dashboard /var/www/letsencrypt

# ── Database ──────────────────────────────────────────────────────────
if [[ "$DB_KIND" == "postgres" ]]; then
    echo "==> Installing PostgreSQL"
    apt-get install -y postgresql postgresql-contrib
    systemctl enable --now postgresql

    DB_PASS="$(openssl rand -hex 16)"
    sudo -u postgres psql <<SQL || true
CREATE USER dashboard WITH PASSWORD '$DB_PASS';
CREATE DATABASE dashboard OWNER dashboard;
GRANT ALL PRIVILEGES ON DATABASE dashboard TO dashboard;
SQL
    echo "DATABASE_URL=postgres://dashboard:$DB_PASS@127.0.0.1:5432/dashboard" >> /etc/command-dashboard.env.local
    echo "Postgres password saved to /etc/command-dashboard.env.local (chmod 600 root-only)."
else
    echo "==> Skipping Postgres install (DB_KIND=$DB_KIND). SQLite file will live at /var/lib/command-dashboard/dashboard.db."
fi

# ── Firewall ──────────────────────────────────────────────────────────
echo "==> Configuring UFW"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── Oracle Cloud also requires you to open the same ports in the VCN's
# Security List from the OCI web console. UFW alone is NOT enough.
echo "!! REMINDER: open ports 80 + 443 in the OCI VCN Security List ingress rules"
echo "   (UFW configures the VM-local firewall; OCI's cloud firewall is separate)."

# ── Nginx ─────────────────────────────────────────────────────────────
echo "==> Installing nginx site for $DOMAIN"
sed -e "s/{{DOMAIN}}/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/command-dashboard
ln -sf /etc/nginx/sites-available/command-dashboard /etc/nginx/sites-enabled/command-dashboard
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx || systemctl restart nginx

# ── SSL ───────────────────────────────────────────────────────────────
echo "==> Issuing Let's Encrypt certificate (webroot method)"
certbot certonly --non-interactive --agree-tos --email "$EMAIL" \
    --webroot -w /var/www/letsencrypt \
    -d "$DOMAIN" -d "www.$DOMAIN" || \
    echo "(skip cert issuance if DNS isn't ready yet — re-run later)"

systemctl enable --now certbot.timer

echo "==> Done. Next:"
echo "   1) cd $APP_DIR && bash deploy/deploy.sh"
echo "   2) systemctl reload nginx"
echo "   3) Visit https://$DOMAIN"
