# Step 2 — Database Setup

Install PostgreSQL, create the database, and apply the schema.

---

## 1. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo systemctl status postgresql
```

---

## 2. Create Database and User

```bash
sudo -u postgres psql
```

Inside the psql shell:

```sql
CREATE USER thermio_user WITH PASSWORD 'your_strong_password_here';
CREATE DATABASE thermio_db OWNER thermio_user;
GRANT ALL PRIVILEGES ON DATABASE thermio_db TO thermio_user;
\q
```

> **Important:** Use a strong, unique password. Store it in your `.env` file as `DATABASE_URL`.

---

## 3. Apply the Schema

```bash
cd /home/$(whoami)/therme
psql -U thermio_user -d thermio_db -h localhost -f database/schema.sql
```

If prompted for password, enter the one you set above.

Verify tables were created:

```bash
psql -U thermio_user -d thermio_db -h localhost -c "\dt"
```

You should see: `exports`, `notifications`, `session`, `temp_logs`, `users`, `vehicle_notes`, `vehicles`, `workspace_logs`, `workspaces`

---

## 4. Memory Tuning for 1GB VPS

Run as superuser (helps performance on low-RAM servers):

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '128MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '4MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET maintenance_work_mem = '64MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '384MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET wal_buffers = '4MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 50;"
sudo -u postgres psql -c "SELECT pg_reload_conf();"
sudo systemctl restart postgresql
```

---

## 5. Build Your DATABASE_URL

```
postgresql://thermio_user:your_strong_password_here@localhost:5432/thermio_db
```

Add this to your `.env` file (see Step 4).

---

## Common Errors

| Error | Fix |
|-------|-----|
| `FATAL: role "thermio_user" does not exist` | Run the CREATE USER step above |
| `FATAL: database "thermio_db" does not exist` | Run CREATE DATABASE step |
| `Connection refused` on port 5432 | `sudo systemctl start postgresql` |
| `schema.sql` fails partway through | Drop and recreate the DB, then retry |
| `permission denied for table` | Run `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO thermio_user;` |

---

**Next:** [Step 3 — Nginx + SSL](./3-nginx-ssl.md)
