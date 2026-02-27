// repositories/WorkspaceRepo.js — PostgreSQL-backed workspace storage
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SETTINGS = {
  timezone: 'Australia/Perth',
  signoff: { dayOfWeek: 5, requireOdometer: true, requireSignature: true },
  retentionEnabled: false,
  retentionDays: 365
};

const WorkspaceRepo = {
  async getAll() {
    const r = await pool.query('SELECT * FROM workspaces ORDER BY created_at DESC');
    return r.rows.map(mapRow);
  },

  async getById(id) {
    if (!id) return null;
    const r = await pool.query('SELECT * FROM workspaces WHERE id = $1', [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getBySlug(slug) {
    if (!slug) return null;
    const r = await pool.query('SELECT * FROM workspaces WHERE slug = $1', [slug]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async slugAvailable(slug) {
    const r = await pool.query('SELECT id FROM workspaces WHERE slug = $1', [slug]);
    return r.rows.length === 0;
  },

  async create(data) {
    const id = uuidv4();
    const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    const r = await pool.query(`
      INSERT INTO workspaces (id, name, slug, status, max_users, max_vehicles,
        branding, settings, export_settings, checklist_questions, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      RETURNING *
    `, [
      id,
      data.name,
      data.slug,
      data.status || 'active',
      data.maxUsers || 20,
      data.maxVehicles || 20,
      JSON.stringify(data.branding || {}),
      JSON.stringify(settings),
      JSON.stringify(data.exportSettings || {}),
      JSON.stringify(data.checklistQuestions || [])
    ]);
    return mapRow(r.rows[0]);
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let i = 1;

    if (updates.name !== undefined)       { fields.push(`name=$${i++}`);       values.push(updates.name); }
    if (updates.slug !== undefined)       { fields.push(`slug=$${i++}`);       values.push(updates.slug); }
    if (updates.status !== undefined)     { fields.push(`status=$${i++}`);     values.push(updates.status); }
    if (updates.maxUsers !== undefined)   { fields.push(`max_users=$${i++}`);  values.push(updates.maxUsers); }
    if (updates.maxVehicles !== undefined){ fields.push(`max_vehicles=$${i++}`);values.push(updates.maxVehicles); }
    if (updates.branding !== undefined)   { fields.push(`branding=$${i++}`);   values.push(JSON.stringify(updates.branding)); }
    if (updates.settings !== undefined)   { fields.push(`settings=$${i++}`);   values.push(JSON.stringify(updates.settings)); }
    if (updates.exportSettings !== undefined) { fields.push(`export_settings=$${i++}`); values.push(JSON.stringify(updates.exportSettings)); }
    if (updates.checklistQuestions !== undefined) { fields.push(`checklist_questions=$${i++}`); values.push(JSON.stringify(updates.checklistQuestions)); }

    if (!fields.length) return await WorkspaceRepo.getById(id);

    fields.push(`updated_at=NOW()`);
    values.push(id);

    const r = await pool.query(
      `UPDATE workspaces SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async updateSettings(id, partial) {
    const ws = await WorkspaceRepo.getById(id);
    if (!ws) return null;
    const settings = { ...(ws.settings || {}), ...partial };
    return WorkspaceRepo.update(id, { settings });
  },

  async updateBranding(id, brandingUpdates) {
    const ws = await WorkspaceRepo.getById(id);
    if (!ws) return null;
    const branding = { ...(ws.branding || {}), ...brandingUpdates };
    return WorkspaceRepo.update(id, { branding });
  },

  async updateChecklistQuestions(id, questions) {
    return WorkspaceRepo.update(id, { checklistQuestions: questions });
  },

  async updateExportSettings(id, exportSettings) {
    return WorkspaceRepo.update(id, { exportSettings });
  },

  async setLimits(id, maxUsers, maxVehicles) {
    return WorkspaceRepo.update(id, { maxUsers, maxVehicles });
  },

  async suspend(id) {
    return WorkspaceRepo.update(id, { status: 'suspended' });
  },

  async activate(id) {
    return WorkspaceRepo.update(id, { status: 'active' });
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    maxUsers: row.max_users,
    maxVehicles: row.max_vehicles,
    branding: row.branding || {},
    settings: row.settings || {},
    exportSettings: row.export_settings || {},
    checklistQuestions: row.checklist_questions || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = WorkspaceRepo;
