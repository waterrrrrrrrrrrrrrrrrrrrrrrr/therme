#!/usr/bin/env bash
# =============================================================
# THERMIO TMS — PostgreSQL Setup Guide
# =============================================================
# This script PRINTS instructions only. It does NOT run anything.
# Read every step. Follow them in order on your Ubuntu 24.04 VPS.
# =============================================================

cat << "GUIDE"

╔══════════════════════════════════════════════════════════════╗
║       THERMIO TMS — PostgreSQL Setup Guide                  ║
║       Ubuntu 24.04 · 1 GB RAM VPS                           ║
╚══════════════════════════════════════════════════════════════╝

This guide walks you through installing and configuring PostgreSQL
for Thermio TMS. Follow every step carefully.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — SSH INTO YOUR VPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From your local computer, open a terminal and run:

    ssh root@YOUR_VPS_IP

Replace YOUR_VPS_IP with your actual server IP address.

What you should see:
    Welcome to Ubuntu 24.04 LTS ...
    root@yourserver:~#

If this fails:
  • Check you have the correct IP address
  • Ensure your SSH key is added: ssh-add ~/.ssh/id_rsa
  • Try: ssh -i ~/.ssh/your_key root@YOUR_VPS_IP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — VERIFY UBUNTU VERSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run:

    lsb_release -a

What you should see:
    Description: Ubuntu 24.04 LTS

If it shows a different version, these instructions still work
for Ubuntu 22.04. For other versions, check PostgreSQL docs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — UPDATE SYSTEM PACKAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run:

    apt-get update && apt-get upgrade -y

What you should see:
    ... (list of packages) ...
    0 upgraded, 0 newly installed ...

This may take 2-5 minutes. Let it finish.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — INSTALL POSTGRESQL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run:

    apt-get install -y postgresql postgresql-contrib

What you should see:
    ... (installing) ...
    Created symlink ... postgresql.service ...

Verify it is running:

    systemctl status postgresql

What you should see:
    ● postgresql.service - ...
       Active: active (running) ...

If it says "inactive" or "failed":
    systemctl start postgresql
    systemctl enable postgresql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — CREATE THE DATABASE AND USER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Switch to the postgres system user:

    sudo -u postgres psql

You will now be inside the PostgreSQL shell (prompt shows: postgres=#)

Run these commands ONE AT A TIME. Press Enter after each.

Create the database:
    CREATE DATABASE thermio_db;

Create the user (replace STRONG_PASSWORD with a real password — 20+ chars):
    CREATE USER thermio_user WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD';

Grant privileges:
    GRANT ALL PRIVILEGES ON DATABASE thermio_db TO thermio_user;

Allow schema permissions (required for PostgreSQL 15+):
    \c thermio_db
    GRANT ALL ON SCHEMA public TO thermio_user;

Exit the PostgreSQL shell:
    \q

What you should see after each command:
    CREATE DATABASE
    CREATE ROLE
    GRANT
    GRANT

Common mistakes:
  • Do NOT forget the semicolon (;) at the end of each SQL command
  • The password must be in single quotes: 'your_password'
  • STRONG_PASSWORD should not contain single quotes — use letters, digits, hyphens

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6 — RUN THE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Navigate to your app directory:

    cd /var/www/thermio

Run the schema file:

    sudo -u postgres psql -d thermio_db -f database/schema.sql

What you should see:
    CREATE EXTENSION
    CREATE TABLE
    CREATE INDEX
    ... (many lines) ...
    CREATE TRIGGER
    (8-9 tablenames listed at the end)

If you see an error like "already exists":
    The schema was run before. Drop and recreate:
    sudo -u postgres psql -c "DROP DATABASE thermio_db;"
    sudo -u postgres psql -c "CREATE DATABASE thermio_db;"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE thermio_db TO thermio_user;"
    sudo -u postgres psql -d thermio_db -c "GRANT ALL ON SCHEMA public TO thermio_user;"
    sudo -u postgres psql -d thermio_db -f database/schema.sql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 7 — TUNE POSTGRESQL FOR 1 GB RAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These settings reduce memory use on a small VPS.

Find the config file:

    sudo -u postgres psql -c "SHOW config_file;"

It will be something like:
    /etc/postgresql/16/main/postgresql.conf

Edit it:

    nano /etc/postgresql/16/main/postgresql.conf

Find and change these lines (use Ctrl+W to search):

    shared_buffers = 128MB        # was 128MB, keep or reduce to 64MB
    work_mem = 4MB                # was 4MB, fine as-is
    maintenance_work_mem = 64MB   # was 64MB, fine
    effective_cache_size = 384MB  # total memory PostgreSQL expects to use
    max_connections = 50          # reduce from 100 to save RAM
    wal_buffers = 4MB

Save: Ctrl+O, Enter, then Ctrl+X to exit.

Restart PostgreSQL to apply:

    systemctl restart postgresql

Verify it started:

    systemctl status postgresql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 8 — TEST THE DATABASE CONNECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Test connecting as thermio_user:

    psql -U thermio_user -d thermio_db -h 127.0.0.1 -c "\dt"

What you should see:
    A list of tables including: users, workspaces, vehicles, temp_logs, etc.

If you see "password authentication failed":
  • Your password is wrong. Reset it:
    sudo -u postgres psql -c "ALTER USER thermio_user PASSWORD 'new_password';"
  • Update DATABASE_URL in .env

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 9 — SET DATABASE_URL IN .env
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Edit your .env file:

    nano /var/www/thermio/.env

Find the DATABASE_URL line and set it:

    DATABASE_URL=postgresql://thermio_user:STRONG_PASSWORD@localhost:5432/thermio_db

Replace STRONG_PASSWORD with the password you chose in Step 5.

Save: Ctrl+O, Enter, Ctrl+X.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 10 — RESTART PM2 AND VERIFY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Restart the app:

    pm2 restart thermio

Check logs for database connection:

    pm2 logs thermio --lines 30

What you should see:
    Thermio started | env=production | port=3000

If you see a database connection error:
  • Double-check DATABASE_URL in .env
  • Ensure PostgreSQL is running: systemctl status postgresql
  • Check pg_hba.conf allows local connections:
    nano /etc/postgresql/16/main/pg_hba.conf
    Ensure this line exists:
    local   all   all   md5

Then:
    systemctl restart postgresql
    pm2 restart thermio

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 11 — VERIFY TENANT ISOLATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every table has workspace_id. Thermio only queries with:
    WHERE workspace_id = $1

To manually verify isolation, connect to the DB:

    sudo -u postgres psql -d thermio_db

Check a workspace's data:
    SELECT id, name, slug FROM workspaces;
    SELECT id, username, workspace_id FROM users WHERE workspace_id = 'WORKSPACE_UUID';

Users from one workspace cannot see another workspace's data
because every query is scoped by workspace_id in the application layer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 12 — BACKUP INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Manual backup:

    sudo -u postgres pg_dump thermio_db > /var/backups/thermio_$(date +%Y%m%d).sql

Automated daily backup (add to crontab):

    crontab -e

Add this line:

    0 2 * * * sudo -u postgres pg_dump thermio_db > /var/backups/thermio_$(date +\%Y\%m\%d).sql 2>&1

Restore from backup:

    sudo -u postgres psql thermio_db < /var/backups/thermio_YYYYMMDD.sql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON ERRORS AND FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERROR: "role thermio_user does not exist"
FIX: You skipped Step 5. Run it now.

ERROR: "FATAL: password authentication failed"
FIX: Wrong password in DATABASE_URL. Reset the password (see Step 8).

ERROR: "could not connect to server: Connection refused"
FIX: PostgreSQL is not running. Run: systemctl start postgresql

ERROR: "permission denied for schema public"
FIX: Run: sudo -u postgres psql -d thermio_db -c "GRANT ALL ON SCHEMA public TO thermio_user;"

ERROR: "relation does not exist"
FIX: Schema not applied. Run Step 6.

GUIDE
