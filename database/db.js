// database/db.js
// PostgreSQL Database Helper Module

const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'truck_logger',
    user: process.env.DB_USER || 'truck_admin',
    password: process.env.DB_PASSWORD,
    max: 20, // Maximum number of clients in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
    process.exit(-1);
});

// ============================================
// STAFF QUERIES
// ============================================

const staffQueries = {
    // Get all staff
    getAll: async () => {
        const result = await pool.query(
            'SELECT * FROM staff ORDER BY id ASC'
        );
        return result.rows;
    },

    // Get active staff only
    getActive: async () => {
        const result = await pool.query(
            'SELECT * FROM staff WHERE active = true ORDER BY name ASC'
        );
        return result.rows;
    },

    // Get staff by ID
    getById: async (id) => {
        const result = await pool.query(
            'SELECT * FROM staff WHERE id = $1',
            [id]
        );
        return result.rows[0];
    },

    // Create new staff member
    create: async (name, pinHash, role = 'driver') => {
        const result = await pool.query(`
            INSERT INTO staff (name, pin_hash, role, active, must_change_pin)
            VALUES ($1, $2, $3, true, true)
            RETURNING *
        `, [name, pinHash, role]);
        return result.rows[0];
    },

    // Update staff
    update: async (id, data) => {
        const fields = [];
        const values = [];
        let paramCount = 1;

        Object.keys(data).forEach(key => {
            fields.push(`${key} = $${paramCount}`);
            values.push(data[key]);
            paramCount++;
        });

        values.push(id);
        const result = await pool.query(`
            UPDATE staff 
            SET ${fields.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `, values);
        return result.rows[0];
    },

    // Update PIN
    updatePin: async (id, pinHash, mustChange = false) => {
        const result = await pool.query(`
            UPDATE staff 
            SET pin_hash = $1, must_change_pin = $2
            WHERE id = $3
            RETURNING *
        `, [pinHash, mustChange, id]);
        return result.rows[0];
    },

    // Deactivate staff
    deactivate: async (id) => {
        const result = await pool.query(
            'UPDATE staff SET active = false WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    },

    // Reactivate staff
    reactivate: async (id) => {
        const result = await pool.query(
            'UPDATE staff SET active = true WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    }
};

// ============================================
// VEHICLE QUERIES
// ============================================

const vehicleQueries = {
    // Get all vehicles
    getAll: async () => {
        const result = await pool.query(
            'SELECT * FROM vehicles ORDER BY id ASC'
        );
        return result.rows;
    },

    // Get active vehicles only
    getActive: async () => {
        const result = await pool.query(
            'SELECT * FROM vehicles WHERE deactivated = false ORDER BY rego ASC'
        );
        return result.rows;
    },

    // Get vehicle by ID
    getById: async (id) => {
        const result = await pool.query(
            'SELECT * FROM vehicles WHERE id = $1',
            [id]
        );
        return result.rows[0];
    },

    // Create new vehicle
    create: async (rego, vehicleClass) => {
        const result = await pool.query(`
            INSERT INTO vehicles (rego, class, deactivated)
            VALUES ($1, $2, false)
            RETURNING *
        `, [rego, vehicleClass]);
        return result.rows[0];
    },

    // Update vehicle
    update: async (id, rego, vehicleClass) => {
        const result = await pool.query(`
            UPDATE vehicles 
            SET rego = $1, class = $2
            WHERE id = $3
            RETURNING *
        `, [rego, vehicleClass, id]);
        return result.rows[0];
    },

    // Deactivate vehicle
    deactivate: async (id) => {
        const result = await pool.query(
            'UPDATE vehicles SET deactivated = true WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    },

    // Reactivate vehicle
    reactivate: async (id) => {
        const result = await pool.query(
            'UPDATE vehicles SET deactivated = false WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    }
};

// ============================================
// LOG QUERIES
// ============================================

const logQueries = {
    // Get all logs
    getAll: async () => {
        const result = await pool.query(`
            SELECT l.*, 
                   json_agg(
                       json_build_object(
                           'id', t.id,
                           'time', t.time,
                           'type', t.type,
                           'dispatch', t.dispatch,
                           'chiller', t.chiller,
                           'freezer', t.freezer,
                           'cabin', t.cabin
                       ) ORDER BY t.time ASC
                   ) FILTER (WHERE t.id IS NOT NULL) as temps
            FROM logs l
            LEFT JOIN temps t ON l.id = t.log_id
            GROUP BY l.id
            ORDER BY l.date DESC
        `);
        return result.rows.map(row => ({
            ...row,
            temps: row.temps || []
        }));
    },

    // Get logs by driver ID
    getByDriverId: async (driverId) => {
        const result = await pool.query(`
            SELECT l.*, 
                   json_agg(
                       json_build_object(
                           'id', t.id,
                           'time', t.time,
                           'type', t.type,
                           'dispatch', t.dispatch,
                           'chiller', t.chiller,
                           'freezer', t.freezer,
                           'cabin', t.cabin
                       ) ORDER BY t.time ASC
                   ) FILTER (WHERE t.id IS NOT NULL) as temps
            FROM logs l
            LEFT JOIN temps t ON l.id = t.log_id
            WHERE l.driver_id = $1
            GROUP BY l.id
            ORDER BY l.date DESC
        `, [driverId]);
        return result.rows.map(row => ({
            ...row,
            temps: row.temps || []
        }));
    },

    // Get logs by truck ID
    getByTruckId: async (truckId) => {
        const result = await pool.query(`
            SELECT l.*, 
                   json_agg(
                       json_build_object(
                           'id', t.id,
                           'time', t.time,
                           'type', t.type,
                           'dispatch', t.dispatch,
                           'chiller', t.chiller,
                           'freezer', t.freezer,
                           'cabin', t.cabin
                       ) ORDER BY t.time ASC
                   ) FILTER (WHERE t.id IS NOT NULL) as temps
            FROM logs l
            LEFT JOIN temps t ON l.id = t.log_id
            WHERE l.truck_id = $1
            GROUP BY l.id
            ORDER BY l.date DESC
        `, [truckId]);
        return result.rows.map(row => ({
            ...row,
            temps: row.temps || []
        }));
    },

    // Get log by truck ID and date
    getByTruckIdAndDate: async (truckId, date) => {
        const result = await pool.query(`
            SELECT l.*, 
                   json_agg(
                       json_build_object(
                           'id', t.id,
                           'time', t.time,
                           'type', t.type,
                           'dispatch', t.dispatch,
                           'chiller', t.chiller,
                           'freezer', t.freezer,
                           'cabin', t.cabin
                       ) ORDER BY t.time ASC
                   ) FILTER (WHERE t.id IS NOT NULL) as temps
            FROM logs l
            LEFT JOIN temps t ON l.id = t.log_id
            WHERE l.truck_id = $1 AND l.date = $2
            GROUP BY l.id
        `, [truckId, date]);
        
        if (result.rows.length === 0) return null;
        
        return {
            ...result.rows[0],
            temps: result.rows[0].temps || []
        };
    },

    // Create new log
    create: async (truckId, driverId, date) => {
        const result = await pool.query(`
            INSERT INTO logs (truck_id, driver_id, date, checklist_done, shift_done)
            VALUES ($1, $2, $3, false, false)
            RETURNING *
        `, [truckId, driverId, date]);
        return { ...result.rows[0], temps: [] };
    },

    // Update log
    update: async (id, data) => {
        const fields = [];
        const values = [];
        let paramCount = 1;

        Object.keys(data).forEach(key => {
            if (key === 'checklist' && typeof data[key] === 'object') {
                fields.push(`${key} = $${paramCount}::jsonb`);
                values.push(JSON.stringify(data[key]));
            } else {
                fields.push(`${key} = $${paramCount}`);
                values.push(data[key]);
            }
            paramCount++;
        });

        values.push(id);
        const result = await pool.query(`
            UPDATE logs 
            SET ${fields.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `, values);
        return result.rows[0];
    },

    // Update checklist
    updateChecklist: async (truckId, date, checklist) => {
        const result = await pool.query(`
            UPDATE logs 
            SET checklist = $1::jsonb, checklist_done = true
            WHERE truck_id = $2 AND date = $3
            RETURNING *
        `, [JSON.stringify(checklist), truckId, date]);
        return result.rows[0];
    },

    // Update admin signature
    updateAdminSignature: async (truckId, date, signature, signedBy) => {
        const result = await pool.query(`
            UPDATE logs 
            SET admin_signature = $1, 
                admin_signed_by = $2, 
                admin_signed_at = CURRENT_TIMESTAMP
            WHERE truck_id = $3 AND date = $4
            RETURNING *
        `, [signature, signedBy, truckId, date]);
        return result.rows[0];
    },

    // Update comments
    updateComments: async (truckId, date, comments) => {
        const result = await pool.query(`
            UPDATE logs 
            SET comments = $1
            WHERE truck_id = $2 AND date = $3
            RETURNING *
        `, [comments, truckId, date]);
        return result.rows[0];
    },

    // End shift
    endShift: async (truckId, date, odometer = null, signature = null) => {
        const result = await pool.query(`
            UPDATE logs 
            SET shift_done = true,
                end_time = CURRENT_TIMESTAMP,
                odometer = $1,
                signature = $2
            WHERE truck_id = $3 AND date = $4
            RETURNING *
        `, [odometer, signature, truckId, date]);
        return result.rows[0];
    }
};

// ============================================
// TEMP QUERIES
// ============================================

const tempQueries = {
    // Add temperature reading
    add: async (logId, time, type, temps) => {
        const result = await pool.query(`
            INSERT INTO temps (log_id, time, type, dispatch, chiller, freezer, cabin)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            logId,
            time,
            type,
            temps.dispatch || null,
            temps.chiller || null,
            temps.freezer || null,
            temps.cabin || null
        ]);
        return result.rows[0];
    },

    // Get temps for a log
    getByLogId: async (logId) => {
        const result = await pool.query(
            'SELECT * FROM temps WHERE log_id = $1 ORDER BY time ASC',
            [logId]
        );
        return result.rows;
    },

    // Update temp reading
    update: async (id, temps) => {
        const result = await pool.query(`
            UPDATE temps 
            SET dispatch = $1, chiller = $2, freezer = $3, cabin = $4
            WHERE id = $5
            RETURNING *
        `, [
            temps.dispatch || null,
            temps.chiller || null,
            temps.freezer || null,
            temps.cabin || null,
            id
        ]);
        return result.rows[0];
    },

    // Delete temp reading
    delete: async (id) => {
        await pool.query('DELETE FROM temps WHERE id = $1', [id]);
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    pool,
    staff: staffQueries,
    vehicles: vehicleQueries,
    logs: logQueries,
    temps: tempQueries
};
