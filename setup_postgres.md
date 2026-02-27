# PostgreSQL Migration Guide

## Why Migrate from JSON to PostgreSQL?

**Current:** JSON file storage (`data/*.json`)
**Better:** PostgreSQL database

**Benefits:**
- ✅ Better performance with large datasets
- ✅ Data integrity & ACID compliance
- ✅ Concurrent access (multi-user safety)
- ✅ Backup/restore tools
- ✅ Query optimization
- ✅ Relationships & constraints

---

## Step 1: Install PostgreSQL

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify installation
sudo systemctl status postgresql
```

---

## Step 2: Create Database & User

```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL console:
CREATE DATABASE thermio_db;
CREATE USER thermio_user WITH ENCRYPTED PASSWORD 'strong-password-here';
GRANT ALL PRIVILEGES ON DATABASE thermio_db TO thermio_user;
\q
```

---

## Step 3: Install Node.js PostgreSQL Driver

```bash
cd /var/www/thermio_production
npm install pg
```

---

## Step 4: Create Schema

```bash
# Connect to database
psql -U thermio_user -d thermio_db

# Run schema (from database/schema.sql or create tables):
```

**Basic Schema:**

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  max_users INTEGER DEFAULT 20,
  max_questions INTEGER DEFAULT 10,
  branding JSONB,
  settings JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  username VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  password_hash TEXT,
  password_history JSONB,
  password_changed_at TIMESTAMP,
  google_id VARCHAR(255),
  role VARCHAR(50) DEFAULT 'driver',
  is_owner BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  status VARCHAR(50) DEFAULT 'active',
  must_change_password BOOLEAN DEFAULT FALSE,
  consent_accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, username)
);

CREATE INDEX idx_users_workspace ON users(workspace_id);
CREATE INDEX idx_users_google ON users(google_id);

-- Add other tables: vehicles, temp_logs, etc.
```

---

## Step 5: Migrate Data

**Option A: Manual Migration Script**

Create `migrate-to-postgres.js`:

```javascript
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'thermio_user',
  password: 'your-password',
  database: 'thermio_db',
  host: 'localhost',
  port: 5432
});

async function migrate() {
  // Read JSON files
  const workspaces = JSON.parse(fs.readFileSync('./data/workspaces.json'));
  const users = JSON.parse(fs.readFileSync('./data/users.json'));

  // Insert workspaces
  for (const ws of workspaces) {
    await pool.query(
      'INSERT INTO workspaces (id, name, slug, settings, branding) VALUES ($1, $2, $3, $4, $5)',
      [ws.id, ws.name, ws.slug, ws.settings, ws.branding]
    );
  }

  // Insert users
  for (const user of users) {
    await pool.query(
      'INSERT INTO users (id, workspace_id, username, name, email, password_hash, password_history, role, is_owner) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [user.id, user.workspaceId, user.username, user.name, user.email, user.passwordHash, user.passwordHistory, user.role, user.isOwner]
    );
  }

  console.log('✅ Migration complete!');
  await pool.end();
}

migrate().catch(console.error);
```

Run:
```bash
node migrate-to-postgres.js
```

---

## Step 6: Update Repository Files

**Example: UserRepo.js**

```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const UserRepo = {
  async getById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async updatePassword(id, passwordHash, mustChangePassword = false) {
    const user = await this.getById(id);
    const passwordHistory = user.password_history || [];
    if (user.password_hash) {
      passwordHistory.unshift(user.password_hash);
    }
    const trimmedHistory = passwordHistory.slice(0, 3);

    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = $2, password_history = $3, password_changed_at = NOW() WHERE id = $4',
      [passwordHash, mustChangePassword, JSON.stringify(trimmedHistory), id]
    );
    return this.getById(id);
  }
};
```

---

## Step 7: Environment Variables

Add to `.env`:

```env
DATABASE_URL=postgresql://thermio_user:your-password@localhost:5432/thermio_db
```

---

## Step 8: Test Migration

```bash
# Restart application
pm2 restart thermio

# Check logs
pm2 logs thermio

# Test login
# Create a user
# Check data in database:
psql -U thermio_user -d thermio_db -c "SELECT * FROM users LIMIT 5;"
```

---

## Backup & Restore

### Backup
```bash
pg_dump thermio_db > backup-$(date +%Y%m%d).sql
```

### Restore
```bash
psql thermio_db < backup-20250226.sql
```

### Automated Daily Backup
```bash
crontab -e
# Add:
0 2 * * * pg_dump thermio_db > /backups/thermio-$(date +\%Y\%m\%d).sql
```

---

## Troubleshooting

**Connection refused:**
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**Authentication failed:**
- Check password in `.env`
- Verify user exists: `sudo -u postgres psql -c "\du"`

**Database doesn't exist:**
```bash
sudo -u postgres createdb thermio_db
```

---

## Next Steps

✅ PostgreSQL working → Continue to [setup_sessions.md](./setup_sessions.md)
