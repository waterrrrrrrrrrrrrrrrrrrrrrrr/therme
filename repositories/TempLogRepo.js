// repositories/TempLogRepo.js — PostgreSQL-backed temperature log storage
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const TempLogRepo = {
  async getAll() {
    const r = await pool.query('SELECT * FROM temp_logs ORDER BY log_date DESC');
    return r.rows.map(mapRow);
  },

  async getAllByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 ORDER BY log_date DESC',
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async getByWorkspaceAndDate(workspaceId, date) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 AND log_date=$2',
      [workspaceId, date]
    );
    return r.rows.map(mapRow);
  },

  async getByWorkspaceAndDriver(workspaceId, driverId) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 AND driver_id=$2 ORDER BY log_date DESC',
      [workspaceId, driverId]
    );
    return r.rows.map(mapRow);
  },

  async getByWorkspaceAndVehicle(workspaceId, vehicleId) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 AND vehicle_id=$2 ORDER BY log_date DESC',
      [workspaceId, vehicleId]
    );
    return r.rows.map(mapRow);
  },

  async getByWorkspaceVehicleDate(workspaceId, vehicleId, date) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 AND vehicle_id=$2 AND log_date=$3',
      [workspaceId, vehicleId, date]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByWorkspaceDateRange(workspaceId, dateFrom, dateTo) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 AND log_date>=$2 AND log_date<=$3 ORDER BY log_date DESC',
      [workspaceId, dateFrom, dateTo]
    );
    return r.rows.map(mapRow);
  },

  async getRecentByWorkspace(workspaceId, limit = 20) {
    const r = await pool.query(
      'SELECT * FROM temp_logs WHERE workspace_id=$1 ORDER BY log_date DESC LIMIT $2',
      [workspaceId, limit]
    );
    return r.rows.map(mapRow);
  },

  async getLastActivity(workspaceId, vehicleId) {
    let q, params;
    if (vehicleId) {
      q = 'SELECT * FROM temp_logs WHERE workspace_id=$1 AND vehicle_id=$2 ORDER BY log_date DESC LIMIT 1';
      params = [workspaceId, vehicleId];
    } else {
      q = 'SELECT * FROM temp_logs WHERE workspace_id=$1 ORDER BY log_date DESC LIMIT 1';
      params = [workspaceId];
    }
    const r = await pool.query(q, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async countByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT COUNT(*) FROM temp_logs WHERE workspace_id=$1',
      [workspaceId]
    );
    return parseInt(r.rows[0].count);
  },

  async countByWorkspaceAndDate(workspaceId, date) {
    const r = await pool.query(
      'SELECT COUNT(*) FROM temp_logs WHERE workspace_id=$1 AND log_date=$2',
      [workspaceId, date]
    );
    return parseInt(r.rows[0].count);
  },

  async createOrGet(workspaceId, vehicleId, driverId, date) {
    const existing = await TempLogRepo.getByWorkspaceVehicleDate(workspaceId, vehicleId, date);
    if (existing) return existing;

    const r = await pool.query(`
      INSERT INTO temp_logs (
        id, workspace_id, vehicle_id, driver_id, log_date,
        temps, checklist_done, shift_done, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,'[]',false,false,NOW(),NOW())
      RETURNING *
    `, [uuidv4(), workspaceId, vehicleId, driverId, date]);
    return mapRow(r.rows[0]);
  },

  async _update(id, workspaceId, updates) {
    const fields = [];
    const values = [];
    let i = 1;

    const map = {
      temps:             ['temps', v => JSON.stringify(v)],
      checklistDone:     ['checklist_done', v => v],
      checklistSnapshot: ['checklist_snapshot', v => JSON.stringify(v)],
      checklist:         ['checklist', v => JSON.stringify(v)],
      checklistTime:     ['checklist_time', v => v],
      shiftDone:         ['shift_done', v => v],
      odometer:          ['odometer', v => v],
      signature:         ['signature', v => v],
      shiftEndTime:      ['shift_end_time', v => v],
      adminSignature:    ['admin_signature', v => v],
      adminSignedBy:     ['admin_signed_by', v => v],
      adminSignedAt:     ['admin_signed_at', v => v],
      adminIp:           ['ip_address', v => v],
      adminUa:           ['user_agent', v => v],
      comments:          ['comments', v => v],
    };

    for (const [jsKey, [col, transform]] of Object.entries(map)) {
      if (updates[jsKey] !== undefined) {
        fields.push(`${col}=$${i++}`);
        values.push(transform(updates[jsKey]));
      }
    }

    if (!fields.length) return null;
    fields.push(`updated_at=NOW()`);
    values.push(id);
    values.push(workspaceId);

    const r = await pool.query(
      `UPDATE temp_logs SET ${fields.join(',')} WHERE id=$${i} AND workspace_id=$${i+1} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async addTemp(id, workspaceId, tempData) {
    const log = await TempLogRepo.getByWorkspaceVehicleDate(workspaceId, null, null);
    // Fetch current temps then push
    const r = await pool.query(
      'SELECT temps FROM temp_logs WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
    if (!r.rows[0]) return null;
    const temps = r.rows[0].temps || [];
    temps.push({ id: uuidv4(), time: new Date().toISOString(), ...tempData });
    return TempLogRepo._update(id, workspaceId, { temps });
  },

  async editTemp(logId, workspaceId, tempId, updates) {
    const r = await pool.query(
      'SELECT temps FROM temp_logs WHERE id=$1 AND workspace_id=$2',
      [logId, workspaceId]
    );
    if (!r.rows[0]) return null;
    const temps = r.rows[0].temps || [];
    const idx = temps.findIndex(t => t.id === tempId);
    if (idx === -1) return null;
    temps[idx] = { ...temps[idx], ...updates };
    return TempLogRepo._update(logId, workspaceId, { temps });
  },

  async endShift(id, workspaceId, data) {
    const r = await pool.query(
      'SELECT temps FROM temp_logs WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
    if (!r.rows[0]) return null;
    const temps = r.rows[0].temps || [];
    if (data.cabin) {
      temps.push({ id: uuidv4(), time: new Date().toISOString(), type: 'end', cabin: data.cabin });
    }
    return TempLogRepo._update(id, workspaceId, {
      temps,
      shiftDone: true,
      odometer: data.odometer || null,
      signature: data.signature || null,
      shiftEndTime: new Date().toISOString()
    });
  },

  async saveChecklist(id, workspaceId, body, snapshot) {
    return TempLogRepo._update(id, workspaceId, {
      checklistDone: true,
      checklist: body,
      checklistSnapshot: snapshot,
      checklistTime: new Date().toISOString()
    });
  },

  async adminSignOff(id, workspaceId, data) {
    return TempLogRepo._update(id, workspaceId, {
      adminSignature: data.signature,
      adminSignedBy: data.signedBy,
      adminSignedAt: new Date().toISOString(),
      adminIp: data.ipAddress || null,
      adminUa: data.userAgent || null
    });
  },

  async updateComments(id, workspaceId, comments) {
    return TempLogRepo._update(id, workspaceId, { comments });
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    truck_id: row.vehicle_id,   // keep old field name for compatibility
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id,
    date: row.log_date ? (typeof row.log_date === 'string' ? row.log_date : row.log_date.toISOString().split('T')[0]) : null,
    log_date: row.log_date,
    temps: row.temps || [],
    checklist_done: row.checklist_done,
    checklistSnapshot: row.checklist_snapshot || [],
    checklist: row.checklist || {},
    checklist_time: row.checklist_time,
    shift_done: row.shift_done,
    odometer: row.odometer,
    signature: row.signature,
    shift_end_time: row.shift_end_time,
    admin_signature: row.admin_signature,
    admin_signed_by: row.admin_signed_by,
    admin_signed_at: row.admin_signed_at,
    admin_ip: row.ip_address,
    admin_ua: row.user_agent,
    comments: row.comments,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = TempLogRepo;
