// repositories/WorkspaceLogRepo.js — PostgreSQL-backed audit log
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

// Updated event types (spec items 17)
const ACTION = {
  LOGIN:                   'login',
  USER_CREATED:            'user_created',
  USER_SUSPENDED:          'user_suspended',
  USER_SUSPENSION_LIFTED:  'user_suspension_lifted',
  ASSET_CREATED:           'asset_created',
  ASSET_SUSPENDED:         'asset_suspended',
  ASSET_SUSPENSION_LIFTED: 'asset_suspension_lifted',
  TEMP_LOGGED:             'temp_logged',
  SHIFT_ENDED:             'shift_ended',
  SIGNOFF_COMPLETED:       'signoff_completed',
  WORKSPACE_UPDATED:       'workspace_updated',
  LIMITS_UPDATED:          'limits_updated',
  ROLE_CHANGED:            'role_changed',
  SETTINGS_UPDATED:        'settings_updated',
  BACKUP_EXPORTED:         'backup_exported',
  BACKUP_RESTORED:         'backup_restored',
  EXCEPTION_FLAGGED:       'exception_flagged',
  OWNERSHIP_TRANSFERRED:   'ownership_transferred'
};

const WorkspaceLogRepo = {
  ACTION,

  async log({ workspaceId, userId = null, actionType, description = '', metadata = {} }) {
    const r = await pool.query(`
      INSERT INTO workspace_logs (id, workspace_id, user_id, action_type, description, metadata, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
    `, [uuidv4(), workspaceId, userId || null, actionType, description, JSON.stringify(metadata)]);
    return mapRow(r.rows[0]);
  },

  async getByWorkspace(workspaceId, {
    limit = 50, offset = 0, actionType = null, userId = null,
    search = null, dateFrom = null, dateTo = null
  } = {}) {
    const conditions = ['workspace_id=$1'];
    const values = [workspaceId];
    let i = 2;

    if (actionType) { conditions.push(`action_type=$${i++}`); values.push(actionType); }
    if (userId)     { conditions.push(`user_id=$${i++}`);     values.push(userId); }
    if (search) {
      conditions.push(`(LOWER(description) LIKE $${i} OR LOWER(action_type) LIKE $${i})`);
      values.push('%' + search.toLowerCase() + '%');
      i++;
    }
    if (dateFrom) { conditions.push(`created_at>=$${i++}`); values.push(dateFrom); }
    if (dateTo)   { conditions.push(`created_at<=$${i++}`); values.push(dateTo + 'T23:59:59Z'); }

    const where = conditions.join(' AND ');

    const countR = await pool.query(`SELECT COUNT(*) FROM workspace_logs WHERE ${where}`, values);
    const total = parseInt(countR.rows[0].count);

    values.push(limit);
    values.push(offset);
    const dataR = await pool.query(
      `SELECT * FROM workspace_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`,
      values
    );

    return { entries: dataR.rows.map(mapRow), total };
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    actionType: row.action_type,
    description: row.description,
    metadata: row.metadata || {},
    createdAt: row.created_at
  };
}

module.exports = WorkspaceLogRepo;
