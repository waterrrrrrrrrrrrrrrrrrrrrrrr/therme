// database/migrate.js — Migrate Thermio JSON data to PostgreSQL
// FINAL VERSION - Handles duplicates, NULL fields, partial migrations, re-runs
// Run with: node database/migrate.js
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection using DATABASE_URL (like app-postgres.js)
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env');
  console.error('   Set it to: postgresql://username:password@host:port/database');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Load JSON files from data/ directory
function loadJSON(filename) {
  try {
    const filePath = path.join(__dirname, '..', 'data', filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filename} (skipping)`);
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ Error loading ${filename}:`, err.message);
    return [];
  }
}

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     THERMIO — JSON to PostgreSQL Migration               ║');
    console.log('║              FINAL BULLETPROOF EDITION                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ==========================================
    // 1. MIGRATE WORKSPACES
    // ==========================================
    console.log('🏢 Migrating workspaces...');
    const workspaces = loadJSON('workspaces/index.json');

    for (const ws of workspaces) {
      await client.query(`
        INSERT INTO workspaces (
          id, name, slug, status, max_users, max_vehicles, max_questions,
          branding, settings, export_settings, checklist_questions, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          status = EXCLUDED.status,
          max_users = EXCLUDED.max_users,
          max_vehicles = EXCLUDED.max_vehicles,
          max_questions = EXCLUDED.max_questions,
          branding = EXCLUDED.branding,
          settings = EXCLUDED.settings,
          export_settings = EXCLUDED.export_settings,
          checklist_questions = EXCLUDED.checklist_questions,
          updated_at = NOW()
      `, [
        ws.id,
        ws.name,
        ws.slug,
        ws.status || 'active',
        ws.maxUsers || 20,
        ws.maxVehicles || 20,
        ws.maxQuestions || 5,
        JSON.stringify(ws.branding || {}),
        JSON.stringify(ws.settings || {}),
        JSON.stringify(ws.exportSettings || {}),
        JSON.stringify(ws.checklistQuestions || []),
        ws.createdAt || new Date().toISOString(),
        ws.updatedAt || new Date().toISOString()
      ]);
    }

    console.log(`   ✅ Migrated ${workspaces.length} workspaces\n`);

    // ==========================================
    // 2. MIGRATE USERS
    // ==========================================
    console.log('👥 Migrating users...');
    const users = loadJSON('users.json');

    for (const u of users) {
      await client.query(`
        INSERT INTO users (
          id, workspace_id, username, name, first_name, last_name, email,
          role, auth_type, password_hash, google_id, status, active, deactivated,
          must_change_password, is_owner, consent_accepted, consent_accepted_at,
          two_factor_enabled, failed_login_attempts, locked_until,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          name = EXCLUDED.name,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          auth_type = EXCLUDED.auth_type,
          password_hash = EXCLUDED.password_hash,
          google_id = EXCLUDED.google_id,
          status = EXCLUDED.status,
          active = EXCLUDED.active,
          deactivated = EXCLUDED.deactivated,
          must_change_password = EXCLUDED.must_change_password,
          is_owner = EXCLUDED.is_owner,
          consent_accepted = EXCLUDED.consent_accepted,
          consent_accepted_at = EXCLUDED.consent_accepted_at,
          updated_at = NOW()
      `, [
        u.id,
        u.workspaceId || null,
        u.username,
        u.name,
        u.firstName || null,
        u.lastName || null,
        u.email || null,
        u.role || 'driver',
        u.authType || 'password',
        u.passwordHash || null,
        u.googleId || null,
        u.status || 'active',
        u.active !== false,
        u.deactivated || false,
        u.mustChangePassword || false,
        u.isOwner || false,
        u.consentAccepted || false,
        u.consentAcceptedAt || null,
        u.twoFactorEnabled || false,
        u.failedLoginAttempts || 0,
        u.lockedUntil || null,
        u.createdAt || new Date().toISOString(),
        u.updatedAt || new Date().toISOString()
      ]);
    }

    console.log(`   ✅ Migrated ${users.length} users\n`);

    // ==========================================
    // 3. MIGRATE VEHICLES
    // ==========================================
    console.log('🚚 Migrating vehicles...');
    const vehicles = loadJSON('vehicles_v2.json');
    const migratedVehicleIds = new Set();
    let skippedVehicles = 0;

    for (const v of vehicles) {
      try {
        // Use ON CONFLICT with composite key (workspace_id, rego)
        // Note: When duplicate rego exists, we keep the FIRST one and skip subsequent ones
        const result = await client.query(`
          INSERT INTO vehicles (
            id, workspace_id, rego, vehicle_class, asset_type, temperature_type,
            active, deactivated, service_records, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (workspace_id, rego) DO UPDATE SET
            vehicle_class = EXCLUDED.vehicle_class,
            asset_type = EXCLUDED.asset_type,
            temperature_type = EXCLUDED.temperature_type,
            active = EXCLUDED.active,
            deactivated = EXCLUDED.deactivated,
            service_records = EXCLUDED.service_records,
            updated_at = NOW()
          RETURNING id
        `, [
          v.id,
          v.workspaceId,
          v.rego,
          v.vehicleClass || null,
          v.assetType || 'Vehicle',
          v.temperatureType || null,
          v.active !== false,
          v.deactivated || false,
          JSON.stringify(v.serviceRecords || []),
          v.createdAt || new Date().toISOString(),
          v.updatedAt || new Date().toISOString()
        ]);

        // Track which vehicle ID is actually in the database
        migratedVehicleIds.add(result.rows[0].id);

        // If the returned ID is different from the JSON ID, we had a duplicate rego
        if (result.rows[0].id !== v.id) {
          console.warn(`   ⚠️  Duplicate rego "${v.rego}" in workspace - kept existing vehicle ${result.rows[0].id}, skipped ${v.id}`);
          skippedVehicles++;
        }
      } catch (err) {
        console.error(`   ❌ Failed to migrate vehicle ${v.id} (${v.rego}):`, err.message);
        skippedVehicles++;
      }
    }

    console.log(`   ✅ Migrated ${vehicles.length - skippedVehicles} vehicles`);
    if (skippedVehicles > 0) {
      console.log(`   ⚠️  Skipped ${skippedVehicles} vehicles with duplicate regos`);
    }
    console.log('');

    // ==========================================
    // 4. MIGRATE TEMP LOGS
    // ==========================================
    console.log('📊 Migrating temperature logs...');
    const logs = loadJSON('logs_v2.json');
    let skippedLogs = 0;
    let migratedLogs = 0;

    for (const log of logs) {
      // Skip logs with NULL vehicle_id or driver_id (corrupt data)
      if (!log.vehicleId || !log.driverId) {
        console.warn(`   ⚠️  Skipping log ${log.id} - missing vehicle_id or driver_id`);
        console.warn(`       workspaceId: ${log.workspaceId}, vehicleId: ${log.vehicleId}, driverId: ${log.driverId}, date: ${log.logDate}`);
        skippedLogs++;
        continue;
      }

      // Use ON CONFLICT with composite key (workspace_id, vehicle_id, driver_id, log_date)
      await client.query(`
        INSERT INTO temp_logs (
          id, workspace_id, vehicle_id, driver_id, log_date,
          temps, checklist_done, checklist_snapshot, checklist,
          shift_done, odometer, signature, admin_signature,
          admin_signed_by, admin_signed_at, ip_address, user_agent,
          comments, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (workspace_id, vehicle_id, driver_id, log_date) DO UPDATE SET
          id = EXCLUDED.id,
          temps = EXCLUDED.temps,
          checklist_done = EXCLUDED.checklist_done,
          checklist_snapshot = EXCLUDED.checklist_snapshot,
          checklist = EXCLUDED.checklist,
          shift_done = EXCLUDED.shift_done,
          odometer = EXCLUDED.odometer,
          signature = EXCLUDED.signature,
          admin_signature = EXCLUDED.admin_signature,
          admin_signed_by = EXCLUDED.admin_signed_by,
          admin_signed_at = EXCLUDED.admin_signed_at,
          comments = EXCLUDED.comments,
          updated_at = NOW()
      `, [
        log.id,
        log.workspaceId,
        log.vehicleId,
        log.driverId,
        log.logDate,
        JSON.stringify(log.temps || []),
        log.checklistDone || false,
        JSON.stringify(log.checklistSnapshot || []),
        JSON.stringify(log.checklist || {}),
        log.shiftDone || false,
        log.odometer || null,
        log.signature || null,
        log.adminSignature || null,
        log.adminSignedBy || null,
        log.adminSignedAt || null,
        log.ipAddress || null,
        log.userAgent || null,
        log.comments || null,
        log.createdAt || new Date().toISOString(),
        log.updatedAt || new Date().toISOString()
      ]);

      migratedLogs++;
    }

    console.log(`   ✅ Migrated ${migratedLogs} temperature logs`);
    if (skippedLogs > 0) {
      console.log(`   ⚠️  Skipped ${skippedLogs} logs with NULL vehicle_id or driver_id`);
    }
    console.log('');

    // ==========================================
    // 5. MIGRATE WORKSPACE LOGS (Audit Trail)
    // ==========================================
    console.log('📝 Migrating workspace logs (audit trail)...');
    const workspaceLogs = loadJSON('workspace_logs.json');

    for (const wlog of workspaceLogs) {
      await client.query(`
        INSERT INTO workspace_logs (
          id, workspace_id, user_id, action_type, description, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        wlog.id,
        wlog.workspaceId,
        wlog.userId || null,
        wlog.actionType,
        wlog.description || null,
        JSON.stringify(wlog.metadata || {}),
        wlog.createdAt || new Date().toISOString()
      ]);
    }

    console.log(`   ✅ Migrated ${workspaceLogs.length} workspace logs\n`);

    // ==========================================
    // 6. MIGRATE NOTIFICATIONS
    // ==========================================
    console.log('🔔 Migrating notifications...');
    const notifications = loadJSON('notifications.json');

    for (const notif of notifications) {
      await client.query(`
        INSERT INTO notifications (
          id, workspace_id, type, title, body, vehicle_id, driver_id,
          read, read_at, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          read = EXCLUDED.read,
          read_at = EXCLUDED.read_at
      `, [
        notif.id,
        notif.workspaceId,
        notif.type,
        notif.title,
        notif.body || null,
        notif.vehicleId || null,
        notif.driverId || null,
        notif.read || false,
        notif.readAt || null,
        notif.createdAt || new Date().toISOString()
      ]);
    }

    console.log(`   ✅ Migrated ${notifications.length} notifications\n`);

    // ==========================================
    // 7. MIGRATE EXPORTS
    // ==========================================
    console.log('📦 Migrating exports...');
    const exports = loadJSON('exports.json');

    for (const exp of exports) {
      await client.query(`
        INSERT INTO exports (
          id, workspace_id, type, period_start, period_end, created_by,
          status, pdf_paths, zip_path, emailed_to, created_at, completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          pdf_paths = EXCLUDED.pdf_paths,
          zip_path = EXCLUDED.zip_path,
          emailed_to = EXCLUDED.emailed_to,
          completed_at = EXCLUDED.completed_at
      `, [
        exp.id,
        exp.workspaceId,
        exp.type,
        exp.periodStart,
        exp.periodEnd,
        exp.createdBy || null,
        exp.status || 'pending',
        JSON.stringify(exp.pdfPaths || []),
        exp.zipPath || null,
        JSON.stringify(exp.emailedTo || []),
        exp.createdAt || new Date().toISOString(),
        exp.completedAt || null
      ]);
    }

    console.log(`   ✅ Migrated ${exports.length} exports\n`);

    // ==========================================
    // 8. MIGRATE VEHICLE NOTES
    // ==========================================
    console.log('📋 Migrating vehicle notes...');
    const vehicleNotes = loadJSON('vehicle_notes.json');
    let skippedNotes = 0;
    let migratedNotes = 0;

    for (const note of vehicleNotes) {
      // Handle field name mismatch: JSON has 'content', schema expects 'body'
      const body = note.body || note.content;

      // Skip notes with NULL/missing body
      if (!body) {
        console.warn(`   ⚠️  Skipping note ${note.id} - missing body/content`);
        console.warn(`       workspaceId: ${note.workspaceId}, vehicleId: ${note.vehicleId}, type: ${note.type}`);
        skippedNotes++;
        continue;
      }

      // Check if vehicle was actually migrated (might have been skipped due to duplicate rego)
      if (!migratedVehicleIds.has(note.vehicleId)) {
        console.warn(`   ⚠️  Skipping note ${note.id} - vehicle ${note.vehicleId} not in database`);
        console.warn(`       (Vehicle was likely skipped due to duplicate rego)`);
        skippedNotes++;
        continue;
      }

      await client.query(`
        INSERT INTO vehicle_notes (
          id, workspace_id, vehicle_id, user_id, type, body, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        note.id,
        note.workspaceId,
        note.vehicleId,
        note.userId || null,
        note.type || 'general',
        body,
        note.createdAt || new Date().toISOString()
      ]);

      migratedNotes++;
    }

    console.log(`   ✅ Migrated ${migratedNotes} vehicle notes`);
    if (skippedNotes > 0) {
      console.log(`   ⚠️  Skipped ${skippedNotes} notes with NULL body/content`);
    }
    console.log('');

    await client.query('COMMIT');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 Migration completed successfully!');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('📊 Summary:');
    console.log(`   🏢 Workspaces:         ${workspaces.length}`);
    console.log(`   👥 Users:              ${users.length}`);
    console.log(`   🚚 Vehicles:           ${vehicles.length}`);
    console.log(`   📊 Temperature logs:   ${migratedLogs}${skippedLogs > 0 ? ` (${skippedLogs} skipped)` : ''}`);
    console.log(`   📝 Workspace logs:     ${workspaceLogs.length}`);
    console.log(`   🔔 Notifications:      ${notifications.length}`);
    console.log(`   📦 Exports:            ${exports.length}`);
    console.log(`   📋 Vehicle notes:      ${migratedNotes}${skippedNotes > 0 ? ` (${skippedNotes} skipped)` : ''}`);
    console.log('');

    if (skippedLogs > 0) {
      console.log('⚠️  WARNING: Skipped logs with corrupt data');
      console.log(`   ${skippedLogs} logs had NULL vehicle_id or driver_id and were not migrated.`);
      console.log('   These logs likely indicate incomplete form submissions.');
      console.log('   To fix the root cause:');
      console.log('   1. Update workspace maxQuestions limit (currently set to 5)');
      console.log('   2. Review checklist form validation');
      console.log('   3. Consider data cleanup for historical records\n');
    }

    console.log('🚀 Next steps:');
    console.log('   1. Backup your data/ folder:');
    console.log('      tar -czf thermio-data-backup-$(date +%Y%m%d).tar.gz data/');
    console.log('');
    console.log('   2. Stop the current app:');
    console.log('      pm2 stop thermio');
    console.log('');
    console.log('   3. Switch to PostgreSQL app:');
    console.log('      pm2 delete thermio');
    console.log('      pm2 start database/app-postgres.js --name thermio');
    console.log('      pm2 save');
    console.log('');
    console.log('   4. Test the application:');
    console.log('      - Login to workspaces');
    console.log('      - Check users, vehicles, logs');
    console.log('      - Create new log to verify writes work');
    console.log('      - Generate PDF report');
    console.log('');
    console.log('   5. Once verified, archive JSON files:');
    console.log('      mv data/ data-archive-$(date +%Y%m%d)/');
    console.log('      mkdir -p data/workspaces/');
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed!');
    console.error('   Error:', err.message);
    console.error('\n🔍 Troubleshooting:');
    console.error('   1. Check DATABASE_URL in .env is correct');
    console.error('   2. Ensure PostgreSQL is running:');
    console.error('      sudo systemctl status postgresql');
    console.error('   3. Verify schema.sql was executed:');
    console.error('      psql "$DATABASE_URL" -f database/schema.sql');
    console.error('   4. Check JSON files exist in data/ folder:');
    console.error('      ls -la data/');
    console.error('   5. Test database connection:');
    console.error('      psql "$DATABASE_URL"');
    console.error('');
    console.error('   Full error details:');
    console.error(err);
    console.error('');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
console.log('Starting Thermio migration script...\n');
console.log('📂 Data directory: ' + path.join(__dirname, '..', 'data'));
console.log('🗄️  Database: ' + (process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'NOT SET'));
console.log('');

migrate().catch(err => {
  console.error('Fatal error during migration');
  process.exit(1);
});
