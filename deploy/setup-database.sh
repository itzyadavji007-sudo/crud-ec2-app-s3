#!/bin/bash
# Run on the DATABASE instance (Ubuntu 22.04), from inside the cloned repo:
#   sudo bash deploy/setup-database.sh <DB_PASSWORD> <BACKEND_PRIVATE_IP>
# Use a letters+digits password (avoid quotes/special characters).
set -e
DB_PASS="$1"
BACKEND_IP="$2"
if [ -z "$DB_PASS" ] || [ -z "$BACKEND_IP" ]; then
  echo "Usage: sudo bash deploy/setup-database.sh <DB_PASSWORD> <BACKEND_PRIVATE_IP>"; exit 1
fi

apt update -y
DEBIAN_FRONTEND=noninteractive apt install -y mysql-server

# Listen on the private network interface so the backend can connect
sed -i 's/^bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
systemctl restart mysql
systemctl enable mysql

mysql <<SQL
CREATE DATABASE IF NOT EXISTS cruddb;
CREATE USER IF NOT EXISTS 'crud_user'@'${BACKEND_IP}' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'crud_user'@'${BACKEND_IP}' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON cruddb.* TO 'crud_user'@'${BACKEND_IP}';
FLUSH PRIVILEGES;
SQL

mysql < "$(dirname "$0")/../database/schema.sql"
echo "Database ready. Only ${BACKEND_IP} can log in as crud_user."
