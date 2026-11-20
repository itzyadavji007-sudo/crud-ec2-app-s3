# CRUD App: Frontend EC2 + Backend EC2 + RDS MySQL + S3

This project is a static HTML/CSS/JavaScript frontend served by Nginx, a Node.js/Express API managed by PM2, an Amazon RDS for MySQL database, and a private S3 bucket for file uploads.

## Architecture

Internet/browser -> public Frontend EC2 (Nginx) -> private Backend EC2 (Node/Express :5000, PM2) -> private RDS MySQL (:3306).
The backend uploads and downloads private S3 objects using its EC2 IAM role. The browser only accesses the frontend public IP; Nginx proxies `/api/` to the backend private IP.

## Important project details

- Frontend files: `frontend/index.html`, `frontend/app.js`, `frontend/style.css`.
- Backend: `backend/server.js`, `backend/db.js`, `backend/package.json`.
- Database name: `cruddb`; table: `items`.
- The API creates the `items` table if it does not exist after it can connect to RDS.
- The `items.file_name` column stores the S3 object key and `original_name` stores the user's filename.
- File download route is `/api/files/:id` (the item ID), which redirects to a short-lived presigned S3 URL.
- Supported file types: PDF, JPG, PNG, TXT, DOC, DOCX. Maximum file size: 10 MB.

## Local development

1. Install Node.js 20+ and MySQL 8.
2. From the project root, create the database schema:
   `mysql -u root -p < database/schema.sql`
3. Create a least-privilege local application user in MySQL:
   ```sql
   CREATE USER 'crud_user'@'localhost' IDENTIFIED BY 'replace_with_a_strong_password';
   GRANT ALL PRIVILEGES ON cruddb.* TO 'crud_user'@'localhost';
   FLUSH PRIVILEGES;
   ```
4. In `backend`, copy `.env.example` to `.env` and set `DB_HOST=127.0.0.1`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=cruddb`, `AWS_REGION`, and `S3_BUCKET_NAME`.
5. Run `cd backend && npm install && npm start`. Health check: `http://localhost:5000/api/health`.
6. Open `frontend/index.html` with VS Code Live Server. It calls `http://localhost:5000/api` on localhost.
7. For local S3 upload tests, configure a local AWS credential profile with only the required bucket permissions. Never commit credentials or `.env`.

## GitHub

From the project root:

```bash
git init
git add .
git commit -m "CRUD app with S3 upload"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

The `.gitignore` excludes `.env` and `node_modules`. Keep the repository public for the simplest `git clone` workflow, or use a secure GitHub deploy key/token for a private repository. Never put AWS keys or database passwords in GitHub.

## AWS network design for RDS

Use one VPC, for example `10.0.0.0/16`, in one AWS Region:

- Public subnet A: `10.0.1.0/24` (Frontend EC2 and NAT Gateway).
- Private application subnet A: `10.0.2.0/24` (Backend EC2).
- Private database subnet A: `10.0.3.0/24` (RDS subnet group).
- Private database subnet B: `10.0.4.0/24` in a second Availability Zone (RDS subnet group).

Attach an Internet Gateway to the VPC. Public route table: `0.0.0.0/0 -> Internet Gateway`. Private application route table: `0.0.0.0/0 -> NAT Gateway` so the backend can install packages and clone the repository. RDS remains private and does not need a route to the internet. An S3 Gateway VPC Endpoint can provide private S3 access from the backend subnet; otherwise the backend uses its NAT route for S3.

RDS DB subnet groups require subnets in at least two Availability Zones. Do not make RDS publicly accessible.

## Security groups

- `sg-frontend`: inbound TCP 80 from `0.0.0.0/0`; TCP 443 from `0.0.0.0/0` if using HTTPS; TCP 22 from your current public IP `/32` only.
- `sg-backend`: inbound TCP 5000 from `sg-frontend`; inbound TCP 22 from `sg-frontend` (jump-host SSH only). No public IP.
- `sg-rds`: inbound MySQL TCP 3306 from `sg-backend` only. RDS public access: No.

Keep default outbound rules unless you have a deliberate egress policy.

## Launch EC2

Launch Ubuntu Server 22.04 LTS instances in the same VPC and Region, using a key pair you have downloaded:

- `frontend`: public subnet A, auto-assign public IP enabled, `sg-frontend`.
- `backend`: private application subnet A, auto-assign public IP disabled, `sg-backend`.

Attach the S3 IAM role to the backend EC2 only. Record the frontend public IPv4/Elastic IP and backend private IPv4.

## Create RDS MySQL

Create an RDS for MySQL DB instance in the same VPC and Region. Use a DB subnet group containing private database subnets A and B, set Public access to **No**, and attach `sg-rds`. Set initial database name to `cruddb` if the create form offers it. Record the RDS endpoint (hostname only; no `https://` and no `:3306`).

From the backend EC2, connect with a MySQL client using the RDS endpoint and master username, then create the application user:

```sql
CREATE USER 'crud_user'@'%' IDENTIFIED BY 'a_strong_unique_password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON cruddb.* TO 'crud_user'@'%';
FLUSH PRIVILEGES;
```

The RDS security group restricts network access to the backend security group. Do not open port 3306 to the internet.

## S3 and IAM

1. Create a private S3 bucket in the same Region. Keep Block all public access enabled and default encryption enabled.
2. Create a least-privilege IAM policy allowing `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::YOUR_BUCKET_NAME/*`.
3. Create an EC2-trusted IAM role and attach that policy.
4. Attach the role to the **backend EC2 only**. Do not put AWS access keys in `.env` or GitHub.

## Deploy backend with PM2

SSH to the backend through the frontend jump host (from your local WSL terminal):

```bash
ssh -i ~/3-tier.pem -J ubuntu@<FRONTEND_PUBLIC_IP> ubuntu@<BACKEND_PRIVATE_IP>
```

On the backend instance:

```bash
sudo apt update && sudo apt install -y git
# Clone the repository (public repo example)
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
sudo bash deploy/setup-backend-pm2-rds.sh <RDS_ENDPOINT> <S3_BUCKET_NAME> ap-south-1
```

The script prompts for the `crud_user` password, installs Node.js 20 and PM2, writes `backend/.env`, starts the API with PM2, and configures PM2 startup after reboot. Check:

```bash
sudo -u ubuntu pm2 status
curl http://localhost:5000/api/health
```

Expected health response: `{"status":"ok","database":"connected"}`.

## Deploy frontend with Nginx

SSH to the frontend EC2:

```bash
ssh -i ~/3-tier.pem ubuntu@<FRONTEND_PUBLIC_IP>
sudo apt update && sudo apt install -y git
# Clone the same repository
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>
```

Open `http://<FRONTEND_PUBLIC_IP>` in any browser. The Nginx config serves the frontend and proxies `/api/` to `http://<BACKEND_PRIVATE_IP>:5000`.

## Update after code changes

On your PC:

```bash
git add .
git commit -m "Update CRUD app"
git push
```

On backend:

```bash
cd <repo> && git pull
cd backend && npm install --omit=dev
sudo -u ubuntu pm2 restart crud-backend
```

On frontend:

```bash
cd <repo> && git pull
sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>
```

## Troubleshooting

- Nginx `502 Bad Gateway`: check `sudo -u ubuntu pm2 status`, `pm2 logs crud-backend`, backend SG inbound TCP 5000 from frontend SG, and Nginx backend private IP.
- API health says database unreachable: check RDS endpoint in `backend/.env`, DB username/password/name, RDS status, RDS SG inbound 3306 from backend SG, and that RDS and backend are in the same VPC.
- S3 upload fails with AccessDenied: confirm the IAM role is attached to backend EC2 and policy resource ARN matches the bucket; check Region and bucket name.
- File upload returns 413: Nginx and backend limits are 10 MB.
- Private backend cannot `apt`/`git clone`: check private app subnet route to NAT Gateway and NAT Gateway is in a public subnet with an Elastic IP and route to the Internet Gateway.

## Cost and cleanup

NAT Gateway, EC2, RDS, EBS, public IPv4/Elastic IP, S3 storage/requests, and data transfer can incur charges. Check current AWS pricing and Free Tier eligibility before creating resources. Stop/delete resources when finished; deleting a NAT Gateway and releasing its Elastic IP can reduce idle costs. Do not delete an RDS database unless you have a backup if its data matters.
