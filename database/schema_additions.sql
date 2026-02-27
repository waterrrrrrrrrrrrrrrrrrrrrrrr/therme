-- ============================================================
-- THERMIO — Schema Additions (run after initial schema.sql)
-- Adds columns required by the v9 update.
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks).
-- ============================================================

-- 1. Users: temporary flag, expiry, password history, password changed at
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_temporary       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_history   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- 2. Vehicles: temporary flag, expiry
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_date  TIMESTAMPTZ;

-- 3. Vehicles: add 'ambient' to temperature_type (remove old CHECK, add new)
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_temperature_type_check;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_temperature_type_check
    CHECK (temperature_type IN ('chiller','freezer','cabin','ambient'));

-- 4. Temp logs: add checklist_time and shift_end_time columns
ALTER TABLE temp_logs
  ADD COLUMN IF NOT EXISTS checklist_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shift_end_time TIMESTAMPTZ;

-- 5. Workspace logs: no changes needed (action_type is VARCHAR, accepts new names)

-- Verify
SELECT 'Schema additions applied successfully' AS status;
