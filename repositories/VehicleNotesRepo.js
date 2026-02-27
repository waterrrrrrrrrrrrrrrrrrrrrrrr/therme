// repositories/VehicleNotesRepo.js — PostgreSQL-backed vehicle notes
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const VehicleNotesRepo = {
  async getByVehicle(vehicleId, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM vehicle_notes WHERE vehicle_id=$1 AND workspace_id=$2 ORDER BY created_at DESC',
      [vehicleId, workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async create(data) {
    const r = await pool.query(`
      INSERT INTO vehicle_notes (id, workspace_id, vehicle_id, user_id, type, body, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
    `, [
      uuidv4(),
      data.workspaceId,
      data.vehicleId,
      data.userId || null,
      data.type || 'general',
      data.body || data.content
    ]);
    return mapRow(r.rows[0]);
  },

  async delete(id, workspaceId) {
    await pool.query(
      'DELETE FROM vehicle_notes WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    vehicleId: row.vehicle_id,
    userId: row.user_id,
    type: row.type,
    body: row.body,
    createdAt: row.created_at
  };
}

module.exports = VehicleNotesRepo;
