// repositories/NotificationRepo.js — PostgreSQL-backed notifications
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const TYPE = {
  OVERDUE_VEHICLE:  'overdue_vehicle',
  EXCEPTION:        'exception',
  SIGNOFF_REQUIRED: 'signoff_required',
  SYSTEM:           'system'
};

const NotificationRepo = {
  TYPE,

  async getAllByWorkspace(workspaceId, limit = 50) {
    const r = await pool.query(
      'SELECT * FROM notifications WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2',
      [workspaceId, limit]
    );
    return r.rows.map(mapRow);
  },

  async unreadCount(workspaceId) {
    const r = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE workspace_id=$1 AND read=false',
      [workspaceId]
    );
    return parseInt(r.rows[0].count);
  },

  async hasRecentUnread(workspaceId, type, vehicleId, since) {
    const r = await pool.query(
      'SELECT 1 FROM notifications WHERE workspace_id=$1 AND type=$2 AND vehicle_id=$3 AND read=false AND created_at>=$4 LIMIT 1',
      [workspaceId, type, vehicleId, since]
    );
    return r.rows.length > 0;
  },

  async create(data) {
    const r = await pool.query(`
      INSERT INTO notifications (id, workspace_id, type, title, body, vehicle_id, driver_id, read, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,false,NOW())
      RETURNING *
    `, [
      uuidv4(),
      data.workspaceId,
      data.type,
      data.title,
      data.body || null,
      data.vehicleId || null,
      data.driverId || null
    ]);
    return mapRow(r.rows[0]);
  },

  async markRead(id, workspaceId) {
    await pool.query(
      'UPDATE notifications SET read=true, read_at=NOW() WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
  },

  async markAllRead(workspaceId) {
    await pool.query(
      'UPDATE notifications SET read=true, read_at=NOW() WHERE workspace_id=$1 AND read=false',
      [workspaceId]
    );
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    title: row.title,
    body: row.body,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    read: row.read,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

module.exports = NotificationRepo;
