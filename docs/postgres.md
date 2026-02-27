# PostgreSQL Setup — Thermio TMS

This guide covers installing and connecting PostgreSQL on a fresh Ubuntu 24.04 VPS with 1 GB RAM.

---

## Prerequisites

- Ubuntu 24.04 VPS with root or sudo access
- Thermio TMS deployed at `/var/www/thermio`
- Port 5432 accessible locally (not exposed to internet)

---

## 1. SSH into the VPS

```bash
ssh root@YOUR_VPS_IP
```

Verify Ubuntu version:

```bash
lsb_release -a
# Description: Ubuntu 24.04 LTS
```

---

## 2. Install PostgreSQL

```bash
apt-get update
apt-get install -y postgresql postgresql-contrib
```

Enable and start:

```bash
systemctl enable postgresql
systemctl start postgresql
systemctl status postgresql
```

Expected output:
```
● postgresql.service ...
   Active: active (running)
```

---

## 3. Create Database and User

Enter the PostgreSQL shell:

```bash
sudo -u postgres psql
```

Run each command:

```sql
CREATE DATABASE thermio_db;
CREATE USER thermio_user WITH ENCRYPTED PASSWORD 'YOUR_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE thermio_db TO thermio_user;
\c thermio_db
GRANT ALL ON SCHEMA public TO thermio_user;
\q
```

**Password rules:**
- Minimum 20 characters
- Mix of uppercase, lowercase, digits, symbols
- No single quotes in the password

---

## 4. Apply the Schema

```bash
sudo -u postgres psql -d thermio_db -f /var/www/thermio/database/schema.sql
```

Expected output (last few lines):
```
CREATE TRIGGER
tablename
-----------
exports
notifications
session
temp_logs
users
vehicle_notes
vehicles
workspace_logs
workspaces
```

---

## 5. Tune Memory for 1 GB RAM

Find the config file:

```bash
sudo -u postgres psql -c "SHOW config_file;"
# /etc/postgresql/16/main/postgresql.conf
```

Edit it:

```bash
nano /etc/postgresql/16/main/postgresql.conf
```

Set these values (search with Ctrl+W):

```ini
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 384MB
max_connections = 50
wal_buffers = 4MB
```

Save and restart:

```bash
systemctl restart postgresql
```

---

## 6. Set Environment Variables

Edit `.env`:

```bash
nano /var/www/thermio/.env
```

Add:

```env
DATABASE_URL=postgresql://thermio_user:YOUR_STRONG_PASSWORD@localhost:5432/thermio_db
```

---

## 7. Restart App

```bash
pm2 restart thermio
pm2 logs thermio --lines 20
```

Expected log output:
```
Thermio started | env=production | port=3000
```

---

## 8. Test Connection

```bash
psql -U thermio_user -d thermio_db -h 127.0.0.1 -c "\dt"
```

You should see all tables listed.

---

## 9. Verify Tenant Isolation

Every table has `workspace_id`. The application always queries with:

```sql
WHERE workspace_id = $1
```

This ensures users in Workspace A can never read or write data from Workspace B, even if they have the same username.

To manually inspect:

```bash
sudo -u postgres psql -d thermio_db
```

```sql
SELECT id, slug, status FROM workspaces;
SELECT id, username, workspace_id, role FROM users LIMIT 10;
```

---

## 10. Backup

**Manual backup:**

```bash
sudo -u postgres pg_dump thermio_db > /var/backups/thermio_$(date +%Y%m%d).sql
```

**Automated daily backup (2am):**

```bash
crontab -e
```

Add:

```
0 2 * * * sudo -u postgres pg_dump thermio_db > /var/backups/thermio_$(date +\%Y\%m\%d).sql 2>&1
```

**Restore:**

```bash
sudo -u postgres psql thermio_db < /var/backups/thermio_YYYYMMDD.sql
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `password authentication failed` | Wrong password in DATABASE_URL. Reset: `ALTER USER thermio_user PASSWORD 'new';` |
| `Connection refused` | PostgreSQL not running. `systemctl start postgresql` |
| `permission denied for schema public` | `GRANT ALL ON SCHEMA public TO thermio_user;` |
| `relation does not exist` | Schema not applied. Run Step 4. |
| `too many connections` | Reduce `max_connections` or restart app |

---

## Common Mistakes

1. **Forgetting the semicolon** — Every SQL command needs `;` at the end
2. **Single quotes in password** — Use only alphanumeric + hyphens + underscores in the password
3. **Running schema twice** — Drop and recreate the DB if schema already exists
4. **Cloudflare blocking DB port** — PostgreSQL runs locally on port 5432, not exposed to the internet
