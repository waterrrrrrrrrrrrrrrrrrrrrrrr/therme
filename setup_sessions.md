# Session Store Setup Guide

## Overview

Upgrade from in-memory sessions to persistent session storage for better reliability, scalability, and multi-device session management.

---

## Why Upgrade Session Store?

**Current:** In-memory sessions (default `express-session`)

**Problems:**
- Sessions lost on app restart
- Multi-instance deployments don't share sessions
- Session invalidation doesn't work reliably across devices

**Solution:** Redis or PostgreSQL session store

**Benefits:**
- ✅ Sessions persist across restarts
- ✅ Multi-device logout works reliably
- ✅ Scalable (works with PM2 cluster mode)
- ✅ Session analytics possible

---

## Option A: Redis (Recommended)

### Why Redis?
- **Fast** - In-memory storage
- **Simple** - Easy setup
- **Purpose-built** - Designed for sessions
- **Automatic cleanup** - TTL expiration built-in

---

## Step 1: Install Redis

### Ubuntu/Debian

```bash
# Update packages
sudo apt update

# Install Redis
sudo apt install redis-server

# Start Redis
sudo systemctl start redis

# Enable on boot
sudo systemctl enable redis

# Verify installation
redis-cli ping
# Should return: PONG
```

### Verify Redis is Running

```bash
sudo systemctl status redis
```

**Expected output:**
```
● redis-server.service - Advanced key-value store
   Loaded: loaded
   Active: active (running)
```

---

## Step 2: Install Node.js Redis Session Store

```bash
cd /var/www/thermio_production
npm install connect-redis redis
```

---

## Step 3: Update app.js

### Add Redis Configuration

Find the session configuration block in `app.js`:

```javascript
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

// Create Redis client
const redisClient = createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  legacyMode: true
});

redisClient.connect().catch(console.error);

// Session configuration
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
  })
);
```

---

## Step 4: Update Environment Variables

Add to `.env`:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=your-redis-password (if you set one)
```

---

## Step 5: Test Redis Sessions

### Restart Application

```bash
pm2 restart thermio
pm2 logs thermio
```

**Look for:**
```
✓ Redis connected
```

### Test Session Persistence

1. **Login to Thermio**
2. **Restart the app:**
   ```bash
   pm2 restart thermio
   ```
3. **Refresh browser** - should still be logged in
4. **Change password** - should log out on all devices

### Check Redis Sessions

```bash
redis-cli

# List all sessions
KEYS sess:*

# View a session (copy ID from above)
GET sess:xxxxxxxxxxxxx

# Count sessions
DBSIZE
```

---

## Option B: PostgreSQL Session Store

### Why PostgreSQL?
- Already using PostgreSQL for data
- One less service to manage
- Built-in backup with database

### Install Package

```bash
npm install connect-pg-simple
```

### Update app.js

```javascript
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: 'user_sessions'
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);
```

### Create Sessions Table

```bash
psql -U thermio_user -d thermio_db
```

```sql
CREATE TABLE "user_sessions" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON "user_sessions" ("expire");
```

---

## Troubleshooting

### Redis connection failed

**Check Redis is running:**
```bash
sudo systemctl status redis
```

**Test connection:**
```bash
redis-cli ping
```

**Check firewall:**
```bash
# If Redis is on another server
sudo ufw allow 6379/tcp
```

### Sessions still not persisting

**Check app logs:**
```bash
pm2 logs thermio
```

**Verify Redis client connected:**
```javascript
redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.on('connect', () => console.log('✓ Redis connected'));
```

### Multi-device logout not working

**Verify middleware order:**
1. Session middleware
2. requireLogin middleware (with passwordChangedAt check)
3. Route handlers

**Check session.createdAt is set:**
```javascript
// In login routes
req.session.createdAt = new Date().toISOString();
```

---

## Production Best Practices

### 1. Redis Security

**Set password:**
```bash
sudo nano /etc/redis/redis.conf

# Add:
requirepass your-strong-redis-password

# Restart
sudo systemctl restart redis
```

**Update .env:**
```env
REDIS_PASSWORD=your-strong-redis-password
```

### 2. Redis Persistence

**Enable AOF (Append-Only File):**
```bash
sudo nano /etc/redis/redis.conf

# Add:
appendonly yes
appendfsync everysec
```

### 3. Session Cleanup

**Redis:** Automatic with TTL

**PostgreSQL:** Add cron job
```bash
crontab -e

# Daily cleanup at 3 AM
0 3 * * * psql thermio_db -c "DELETE FROM user_sessions WHERE expire < NOW();"
```

### 4. Monitor Sessions

**Redis:**
```bash
# Active sessions
redis-cli DBSIZE

# Memory usage
redis-cli INFO memory
```

**PostgreSQL:**
```sql
SELECT COUNT(*) FROM user_sessions WHERE expire > NOW();
```

---

## Session Analytics

### Track Active Users

**Query Redis:**
```bash
# Count active sessions
redis-cli DBSIZE
```

**Query PostgreSQL:**
```sql
SELECT
  COUNT(*) as active_sessions,
  COUNT(DISTINCT sess->>'user'->>'workspaceId') as active_workspaces
FROM user_sessions
WHERE expire > NOW();
```

### Track Session Duration

**Add to app.js:**
```javascript
app.use((req, res, next) => {
  if (req.session.user) {
    const duration = Date.now() - new Date(req.session.createdAt).getTime();
    console.log(`Session duration: ${duration / 1000 / 60} minutes`);
  }
  next();
});
```

---

## Performance Tuning

### Redis

**Optimize memory:**
```bash
sudo nano /etc/redis/redis.conf

# Limit memory
maxmemory 256mb
maxmemory-policy allkeys-lru
```

### PostgreSQL

**Add indexes:**
```sql
CREATE INDEX idx_sessions_expire ON user_sessions(expire);
CREATE INDEX idx_sessions_user ON user_sessions((sess->>'user'));
```

---

## Backup & Restore

### Redis

**Backup:**
```bash
# Trigger save
redis-cli SAVE

# Copy dump file
cp /var/lib/redis/dump.rdb /backups/redis-$(date +%Y%m%d).rdb
```

**Restore:**
```bash
sudo systemctl stop redis
cp /backups/redis-20250226.rdb /var/lib/redis/dump.rdb
sudo systemctl start redis
```

### PostgreSQL

**Included in database backup** (see [setup_postgres.md](./setup_postgres.md))

---

## Next Steps

✅ Sessions working → Continue to [setup_security.md](./setup_security.md)
