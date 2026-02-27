// repositories/UserRepo.js — PostgreSQL-backed user storage
'use strict';

const pool = require('../database/pool');
const { v4: uuidv4 } = require('uuid');

const UserRepo = {
  async getAll() {
    const r = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    return r.rows.map(mapRow);
  },

  async getAllByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT * FROM users WHERE workspace_id=$1 ORDER BY created_at DESC',
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async getById(id) {
    if (!id) return null;
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByIdAndWorkspace(id, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM users WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByUsername(username, workspaceId) {
    const r = await pool.query(
      'SELECT * FROM users WHERE username=$1 AND workspace_id=$2',
      [username, workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByEmail(email, workspaceId) {
    if (workspaceId) {
      const r = await pool.query(
        'SELECT * FROM users WHERE email=$1 AND workspace_id=$2',
        [email, workspaceId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    }
    const r = await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [email]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getByGoogleId(googleId) {
    const r = await pool.query('SELECT * FROM users WHERE google_id=$1 LIMIT 1', [googleId]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async getSuperadmin() {
    const r = await pool.query("SELECT * FROM users WHERE role='superadmin' LIMIT 1");
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async usernamesInWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT username FROM users WHERE workspace_id=$1',
      [workspaceId]
    );
    return r.rows.map(u => u.username);
  },

  async countByWorkspace(workspaceId) {
    const r = await pool.query(
      "SELECT COUNT(*) FROM users WHERE workspace_id=$1 AND deactivated=false",
      [workspaceId]
    );
    return parseInt(r.rows[0].count);
  },

  async create(data) {
    const id = data.id || uuidv4();
    const r = await pool.query(`
      INSERT INTO users (
        id, workspace_id, username, name, first_name, last_name, email,
        role, auth_type, password_hash, google_id, status, active, deactivated,
        must_change_password, is_owner, consent_accepted,
        is_temporary, expiry_date,
        password_history, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW())
      RETURNING *
    `, [
      id,
      data.workspaceId || null,
      data.username,
      data.name,
      data.firstName || null,
      data.lastName || null,
      data.email || null,
      data.role || 'driver',
      data.authType || 'password',
      data.passwordHash || null,
      data.googleId || null,
      data.status || 'active',
      data.active !== false,
      data.deactivated || false,
      data.mustChangePassword || false,
      data.isOwner || false,
      data.consentAccepted || false,
      data.isTemporary || false,
      data.expiryDate || null,
      JSON.stringify(data.passwordHistory || [])
    ]);
    return mapRow(r.rows[0]);
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let i = 1;

    const map = {
      name:                ['name', v => v],
      firstName:           ['first_name', v => v],
      lastName:            ['last_name', v => v],
      email:               ['email', v => v],
      role:                ['role', v => v],
      authType:            ['auth_type', v => v],
      passwordHash:        ['password_hash', v => v],
      googleId:            ['google_id', v => v],
      status:              ['status', v => v],
      active:              ['active', v => v],
      deactivated:         ['deactivated', v => v],
      mustChangePassword:  ['must_change_password', v => v],
      isOwner:             ['is_owner', v => v],
      consentAccepted:     ['consent_accepted', v => v],
      consentAt:           ['consent_accepted_at', v => v],
      isTemporary:         ['is_temporary', v => v],
      expiryDate:          ['expiry_date', v => v],
      passwordHistory:     ['password_history', v => JSON.stringify(v)],
      passwordChangedAt:   ['password_changed_at', v => v],
      failedLoginAttempts: ['failed_login_attempts', v => v],
      lockedUntil:         ['locked_until', v => v],
    };

    for (const [jsKey, [col, transform]] of Object.entries(map)) {
      if (updates[jsKey] !== undefined) {
        fields.push(`${col}=$${i++}`);
        values.push(transform(updates[jsKey]));
      }
    }

    if (!fields.length) return await UserRepo.getById(id);
    fields.push(`updated_at=NOW()`);
    values.push(id);

    const r = await pool.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async updatePassword(id, passwordHash, mustChangePassword = false) {
    const user = await UserRepo.getById(id);
    if (!user) return null;

    const passwordHistory = user.passwordHistory || [];
    if (user.passwordHash) passwordHistory.unshift(user.passwordHash);
    const trimmedHistory = passwordHistory.slice(0, 3);

    return UserRepo.update(id, {
      passwordHash,
      mustChangePassword,
      passwordHistory: trimmedHistory,
      passwordChangedAt: new Date().toISOString()
    });
  },

  async isPasswordReused(id, newPassword) {
    const bcrypt = require('bcrypt');
    const user = await UserRepo.getById(id);
    if (!user) return false;
    const history = user.passwordHistory || [];
    for (const oldHash of history) {
      if (await bcrypt.compare(newPassword, oldHash)) return true;
    }
    return false;
  },

  async unlinkGoogle(id) {
    return UserRepo.update(id, { googleId: null, authType: 'password' });
  },

  async setRole(id, role) {
    return UserRepo.update(id, { role });
  },

  async deactivate(id) {
    return UserRepo.update(id, { active: false, deactivated: true });
  },

  async reactivate(id) {
    // Note: reactivate ONLY if user was not manually suspended
    // The suspension state is tracked separately via deactivated=true
    return UserRepo.update(id, { active: true, deactivated: false });
  },

  async linkGoogle(id, googleId, email) {
    const upd = { googleId, authType: 'google' };
    if (email) upd.email = email;
    return UserRepo.update(id, upd);
  },

  async acceptConsent(id) {
    return UserRepo.update(id, {
      consentAccepted: true,
      consentAt: new Date().toISOString()
    });
  },

  async hasAcceptedConsent(id) {
    const user = await UserRepo.getById(id);
    return user ? !!user.consentAccepted : false;
  },

  async getOwnerByWorkspace(workspaceId) {
    const r = await pool.query(
      'SELECT * FROM users WHERE workspace_id=$1 AND is_owner=true LIMIT 1',
      [workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async setOwner(id, isOwner) {
    return UserRepo.update(id, { isOwner: !!isOwner });
  }
};

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    username: row.username,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    authType: row.auth_type,
    passwordHash: row.password_hash,
    googleId: row.google_id,
    status: row.status,
    active: row.active,
    deactivated: row.deactivated,
    mustChangePassword: row.must_change_password,
    isOwner: row.is_owner,
    consentAccepted: row.consent_accepted,
    consentAt: row.consent_accepted_at,
    isTemporary: row.is_temporary || false,
    expiryDate: row.expiry_date || null,
    passwordHistory: row.password_history || [],
    passwordChangedAt: row.password_changed_at,
    failedLoginAttempts: row.failed_login_attempts || 0,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = UserRepo;
