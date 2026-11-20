#!/bin/bash
# Run on the BACKEND EC2 instance from the cloned repository:
# sudo bash deploy/setup-backend-pm2-rds.sh <RDS_ENDPOINT> <S3_BUCKET_NAME> [AWS_REGION]
set -euo pipefail

RDS_ENDPOINT="${1:-}"
S3_BUCKET="${2:-}"
AWS_REGION="${3:-ap-south-1}"
RUN_USER="${SUDO_USER:-ubuntu}"

if [[ -z "$RDS_ENDPOINT" || -z "$S3_BUCKET" ]]; then
  echo "Usage: sudo bash deploy/setup-backend-pm2-rds.sh <RDS_ENDPOINT> <S3_BUCKET_NAME> [AWS_REGION]"
  exit 1
fi

read -rsp "Enter the crud_user password created in RDS: " DB_PASS
echo
if [[ -z "$DB_PASS" ]]; then
  echo "Database password cannot be empty."
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"

apt-get update
apt-get install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

cd "$APP_DIR"
sudo -u "$RUN_USER" -H npm install --omit=dev
npm install -g pm2

cat > "$APP_DIR/.env" <<ENV
PORT=5000
DB_HOST=${RDS_ENDPOINT}
DB_PORT=3306
DB_USER=crud_user
DB_PASSWORD=${DB_PASS}
DB_NAME=cruddb
AWS_REGION=${AWS_REGION}
S3_BUCKET_NAME=${S3_BUCKET}
ENV
chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"
unset DB_PASS

# Start or replace the PM2-managed application under the ubuntu login user.
sudo -u "$RUN_USER" -H bash -lc "cd '$APP_DIR' && (pm2 delete crud-backend >/dev/null 2>&1 || true) && pm2 start server.js --name crud-backend"

# Configure PM2 to start after reboot, then save the current process list.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$RUN_USER" --hp "/home/$RUN_USER"
sudo -u "$RUN_USER" -H pm2 save

sleep 2
echo "Backend deployment finished. Check with: sudo -u $RUN_USER pm2 status"
echo "Health check: curl http://localhost:5000/api/health"
