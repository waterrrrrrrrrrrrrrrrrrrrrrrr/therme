// repositories/ExportRepo.js — PostgreSQL-backed export records
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const ExportRepo = {
  async getAllByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT * FROM exports WHERE workspace_id=$1 ORDER BY created_at DESC',
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async getById(id, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM exports WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(data) {
    const r = await pool.query(`
      INSERT INTO exports (
        id, workspace_id, type, period_start, period_end, created_by,
        status, pdf_paths, zip_path, emailed_to, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      RETURNING *
    `, [
      uuidv4(),
      data.workspaceId,
      data.type || 'pdf',
      data.periodStart || null,
      data.periodEnd || null,
      data.createdBy || null,
      data.status || 'pending',
      JSON.stringify(data.pdfPaths || []),
      data.zipPath || null,
      JSON.stringify(data.emailedTo || [])
    ]);
    return mapRow(r.rows[0]);
  },

  async update(id, workspaceId, updates) {
    const fields = [];
    const values = [];
    let i = 1;

    if (updates.status !== undefined)    { fields.push(`status=$${i++}`);      values.push(updates.status); }
    if (updates.pdfPaths !== undefined)  { fields.push(`pdf_paths=$${i++}`);   values.push(JSON.stringify(updates.pdfPaths)); }
    if (updates.zipPath !== undefined)   { fields.push(`zip_path=$${i++}`);    values.push(updates.zipPath); }
    if (updates.emailedTo !== undefined) { fields.push(`emailed_to=$${i++}`);  values.push(JSON.stringify(updates.emailedTo)); }
    if (updates.completedAt !== undefined) { fields.push(`completed_at=$${i++}`); values.push(updates.completedAt); }
    if (updates.status === 'complete' || updates.status === 'emailed') {
      if (!updates.completedAt) { fields.push(`completed_at=NOW()`); }
    }

    if (!fields.length) return await ExportRepo.getById(id, workspaceId);
    values.push(id);
    values.push(workspaceId);

    const r = await pool.query(
      `UPDATE exports SET ${fields.join(',')} WHERE id=$${i} AND workspace_id=$${i+1} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdBy: row.created_by,
    status: row.status,
    pdfPaths: row.pdf_paths || [],
    zipPath: row.zip_path,
    emailedTo: row.emailed_to || [],
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

module.exports = ExportRepo;
