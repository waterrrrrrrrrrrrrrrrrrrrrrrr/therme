// repositories/VehicleRepo.js — PostgreSQL-backed vehicle/asset storage
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const VehicleRepo = {
  async getAll() {
    const r = await pool.query('SELECT * FROM vehicles ORDER BY created_at DESC');
    return r.rows.map(mapRow);
  },

  async getAllByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT * FROM vehicles WHERE workspace_id=$1 ORDER BY created_at DESC',
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async getByIdAndWorkspace(id, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM vehicles WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByRegoAndWorkspace(rego, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM vehicles WHERE rego=$1 AND workspace_id=$2',
      [rego, workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async countByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT COUNT(*) FROM vehicles WHERE workspace_id=$1 AND deactivated=false',
      [workspaceId]
    );
    return parseInt(r.rows[0].count);
  },

  async create(data) {
    const id = data.id || uuidv4();
    const r = await pool.query(`
      INSERT INTO vehicles (
        id, workspace_id, rego, vehicle_class, asset_type, temperature_type,
        active, deactivated, service_records,
        is_temporary, expiry_date,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      RETURNING *
    `, [
      id,
      data.workspaceId,
      data.rego,
      data.vehicleClass || null,
      data.assetType || 'Vehicle',
      data.temperatureType || null,
      data.active !== false,
      data.deactivated || false,
      JSON.stringify(data.serviceRecords || []),
      data.isTemporary || false,
      data.expiryDate || null
    ]);
    return mapRow(r.rows[0]);
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let i = 1;

    const map = {
      rego:            ['rego', v => v],
      vehicleClass:    ['vehicle_class', v => v],
      assetType:       ['asset_type', v => v],
      temperatureType: ['temperature_type', v => v],
      active:          ['active', v => v],
      deactivated:     ['deactivated', v => v],
      serviceRecords:  ['service_records', v => JSON.stringify(v)],
      isTemporary:     ['is_temporary', v => v],
      expiryDate:      ['expiry_date', v => v],
    };

    for (const [jsKey, [col, transform]] of Object.entries(map)) {
      if (updates[jsKey] !== undefined) {
        fields.push(`${col}=$${i++}`);
        values.push(transform(updates[jsKey]));
      }
    }

    if (!fields.length) return await VehicleRepo.getByIdAndWorkspace(id, updates.workspaceId);
    fields.push(`updated_at=NOW()`);
    values.push(id);

    const r = await pool.query(
      `UPDATE vehicles SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async deactivate(id) {
    return VehicleRepo.update(id, { deactivated: true, active: false });
  },

  async reactivate(id) {
    return VehicleRepo.update(id, { deactivated: false, active: true });
  },

  async addServiceRecord(id, record) {
    const r = await pool.query('SELECT service_records FROM vehicles WHERE id=$1', [id]);
    if (!r.rows[0]) return null;
    const serviceRecords = r.rows[0].service_records || [];
    serviceRecords.push({ id: uuidv4(), createdAt: new Date().toISOString(), ...record });
    return VehicleRepo.update(id, { serviceRecords });
  },

  async deleteServiceRecord(vehicleId, recordId) {
    const r = await pool.query('SELECT service_records FROM vehicles WHERE id=$1', [vehicleId]);
    if (!r.rows[0]) return null;
    const serviceRecords = (r.rows[0].service_records || []).filter(rec => rec.id !== recordId);
    return VehicleRepo.update(vehicleId, { serviceRecords });
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    rego: row.rego,
    vehicleClass: row.vehicle_class,
    assetType: row.asset_type || 'Vehicle',
    temperatureType: row.temperature_type,
    active: row.active,
    deactivated: row.deactivated,
    serviceRecords: row.service_records || [],
    isTemporary: row.is_temporary || false,
    expiryDate: row.expiry_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = VehicleRepo;
