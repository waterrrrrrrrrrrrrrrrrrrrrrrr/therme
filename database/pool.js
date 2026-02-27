// database/pool.js — Shared PostgreSQL connection pool
// Uses DATABASE_URL from .env (set up via setup_postgres.md guide)
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env');
  console.error('   Example: postgresql://thermio_user:password@localhost:5432/thermio_db');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('connect', (client) => {
  if (process.env.NODE_ENV !== 'production') {
    // Suppress per-connection logs in prod
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

// Test connection on startup
pool.query('SELECT 1').then(() => {
  console.log('✅ PostgreSQL connected via DATABASE_URL');
}).catch(err => {
  console.error('❌ PostgreSQL connection failed:', err.message);
  console.error('   Check DATABASE_URL in .env and that postgres is running.');
  process.exit(1);
});

module.exports = pool;
