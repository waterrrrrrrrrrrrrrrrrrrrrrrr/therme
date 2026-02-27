-- ============================================================
-- THERMIO TMS — PostgreSQL Schema
-- Multi-tenant, workspace_id on every table
-- Parameterised queries only — no string interpolation in app
-- Tuned for 1 GB RAM VPS
-- ============================================================

-- UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. WORKSPACES (top-level tenants)
-- ============================================================
CREATE TABLE workspaces (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(255) NOT NULL,
  slug         VARCHAR(100) NOT NULL UNIQUE,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  max_users    INTEGER NOT NULL DEFAULT 20,
  max_vehicles INTEGER NOT NULL DEFAULT 20,
  max_questions INTEGER NOT NULL DEFAULT 5,
  branding     JSONB NOT NULL DEFAULT '{}',
  settings     JSONB NOT NULL DEFAULT '{}',
  export_settings JSONB NOT NULL DEFAULT '{}',
  checklist_questions JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_slug   ON workspaces(slug);
CREATE INDEX idx_workspaces_status ON workspaces(status);

-- ============================================================
-- 2. USERS
-- ============================================================
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id         UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  username             VARCHAR(100) NOT NULL,
  name                 VARCHAR(255) NOT NULL,
  first_name           VARCHAR(100),
  last_name            VARCHAR(100),
  email                VARCHAR(255),
  role                 VARCHAR(20) NOT NULL DEFAULT 'driver' CHECK (role IN ('superadmin','admin','office','driver')),
  auth_type            VARCHAR(20) NOT NULL DEFAULT 'password' CHECK (auth_type IN ('password','google')),
  password_hash        TEXT,
  google_id            VARCHAR(255),
  status               VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated          BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  is_owner             BOOLEAN NOT NULL DEFAULT FALSE,
  consent_accepted     BOOLEAN NOT NULL DEFAULT FALSE,
  consent_accepted_at  TIMESTAMPTZ,
  two_factor_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Usernames unique within a workspace
  UNIQUE (workspace_id, username),
  -- Emails unique within a workspace (null allowed)
  UNIQUE NULLS NOT DISTINCT (workspace_id, email)
);

-- Superadmin has no workspace_id; only one allowed
CREATE UNIQUE INDEX idx_users_superadmin ON users(role) WHERE role = 'superadmin';

CREATE INDEX idx_users_workspace     ON users(workspace_id);
CREATE INDEX idx_users_email         ON users(workspace_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_google_id     ON users(workspace_id, google_id) WHERE google_id IS NOT NULL;
CREATE INDEX idx_users_is_owner      ON users(workspace_id) WHERE is_owner = TRUE;
CREATE INDEX idx_users_active        ON users(workspace_id, active);

-- ============================================================
-- 3. VEHICLES
-- ============================================================
CREATE TABLE vehicles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rego            VARCHAR(50) NOT NULL,
  vehicle_class   VARCHAR(100),
  asset_type      VARCHAR(50) DEFAULT 'Vehicle',
  temperature_type VARCHAR(20) CHECK (temperature_type IN ('chiller','freezer','cabin')),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated     BOOLEAN NOT NULL DEFAULT FALSE,
  service_records JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, rego)
);

CREATE INDEX idx_vehicles_workspace ON vehicles(workspace_id);
CREATE INDEX idx_vehicles_active    ON vehicles(workspace_id, active);

-- ============================================================
-- 4. TEMP LOGS (one per vehicle per driver per day)
-- ============================================================
CREATE TABLE temp_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vehicle_id          UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            DATE NOT NULL,
  temps               JSONB NOT NULL DEFAULT '[]',
  checklist_done      BOOLEAN NOT NULL DEFAULT FALSE,
  checklist_snapshot  JSONB NOT NULL DEFAULT '[]',
  checklist           JSONB NOT NULL DEFAULT '{}',
  shift_done          BOOLEAN NOT NULL DEFAULT FALSE,
  odometer            VARCHAR(50),
  signature           TEXT,
  admin_signature     TEXT,
  admin_signed_by     VARCHAR(255),
  admin_signed_at     TIMESTAMPTZ,
  ip_address          INET,
  user_agent          TEXT,
  comments            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, vehicle_id, driver_id, log_date)
);

CREATE INDEX idx_logs_workspace          ON temp_logs(workspace_id);
CREATE INDEX idx_logs_vehicle            ON temp_logs(workspace_id, vehicle_id);
CREATE INDEX idx_logs_driver             ON temp_logs(workspace_id, driver_id);
CREATE INDEX idx_logs_date               ON temp_logs(workspace_id, log_date);
CREATE INDEX idx_logs_vehicle_date       ON temp_logs(workspace_id, vehicle_id, log_date);
CREATE INDEX idx_logs_shift_done         ON temp_logs(workspace_id, shift_done);
CREATE INDEX idx_logs_updated            ON temp_logs(workspace_id, updated_at);

-- ============================================================
-- 5. WORKSPACE AUDIT LOG
-- ============================================================
CREATE TABLE workspace_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type  VARCHAR(100) NOT NULL,
  description  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wslogs_workspace   ON workspace_logs(workspace_id);
CREATE INDEX idx_wslogs_created_at  ON workspace_logs(workspace_id, created_at DESC);

-- ============================================================
-- 6. NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  body         TEXT,
  vehicle_id   UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_workspace ON notifications(workspace_id);
CREATE INDEX idx_notif_unread    ON notifications(workspace_id, read) WHERE read = FALSE;

-- ============================================================
-- 7. EXPORTS
-- ============================================================
CREATE TABLE exports (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type           VARCHAR(30) NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  created_by     VARCHAR(255),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','emailed')),
  pdf_paths      JSONB NOT NULL DEFAULT '[]',
  zip_path       TEXT,
  emailed_to     JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX idx_exports_workspace ON exports(workspace_id);
CREATE INDEX idx_exports_status    ON exports(workspace_id, status);

-- ============================================================
-- 8. VEHICLE NOTES
-- ============================================================
CREATE TABLE vehicle_notes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  type         VARCHAR(50) DEFAULT 'general',
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vnotes_vehicle ON vehicle_notes(workspace_id, vehicle_id);

-- ============================================================
-- 9. SESSION TABLE (connect-pg-simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session"("expire");

-- ============================================================
-- 10. AUTO-UPDATE TIMESTAMPS
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vehicles_updated   BEFORE UPDATE ON vehicles   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_logs_updated       BEFORE UPDATE ON temp_logs  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- MEMORY TUNING FOR 1 GB RAM
-- Run these as superuser after connecting to the DB:
-- ALTER SYSTEM SET shared_buffers = '128MB';
-- ALTER SYSTEM SET work_mem = '4MB';
-- ALTER SYSTEM SET maintenance_work_mem = '64MB';
-- ALTER SYSTEM SET effective_cache_size = '384MB';
-- ALTER SYSTEM SET wal_buffers = '4MB';
-- ALTER SYSTEM SET max_connections = 50;
-- SELECT pg_reload_conf();
-- ============================================================

-- Verify
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
