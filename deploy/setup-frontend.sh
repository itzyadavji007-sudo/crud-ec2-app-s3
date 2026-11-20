#!/bin/bash
# Run on the FRONTEND instance (Ubuntu 22.04), from inside the cloned repo:
#   sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>
set -e
BACKEND_IP="$1"
if [ -z "$BACKEND_IP" ]; then
  echo "Usage: sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>"; exit 1
fi

FRONT_DIR="$(cd "$(dirname "$0")/../frontend" && pwd)"

apt update -y
apt install -y nginx

mkdir -p /var/www/crud-frontend
cp "$FRONT_DIR"/index.html "$FRONT_DIR"/app.js "$FRONT_DIR"/style.css /var/www/crud-frontend/

sed "s/__BACKEND_IP__/${BACKEND_IP}/g" "$FRONT_DIR/nginx.conf" > /etc/nginx/sites-available/crud
ln -sf /etc/nginx/sites-available/crud /etc/nginx/sites-enabled/crud
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx
echo "Frontend live. Open http://<FRONTEND_PUBLIC_IP>"
