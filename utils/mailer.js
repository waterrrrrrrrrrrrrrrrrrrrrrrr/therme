// utils/mailer.js — Resend email integration
// Set RESEND_API_KEY in .env to enable sending
// MAIL_FROM must be a verified Resend sender address (e.g. no-reply@loveri.ng)
'use strict';

const FROM     = process.env.MAIL_FROM    || 'no-reply@loveri.ng';
const APP_NAME = process.env.APP_NAME     || 'Thermio';
const DEV_MODE = !process.env.RESEND_API_KEY || process.env.NODE_ENV !== 'production';

// Lazy-load Resend so the app starts without the package installed
function getResend() {
  const { Resend } = require('resend');
  return new Resend(process.env.RESEND_API_KEY);
}

// ── Core dispatcher ───────────────────────────────────────────
async function sendMail({ to, subject, html, text }) {
  if (DEV_MODE) {
    console.log('\n========= EMAIL (DEV MODE — NOT SENT) =========');
    console.log('TO:      ' + to);
    console.log('FROM:    ' + FROM);
    console.log('SUBJECT: ' + subject);
    console.log('--- BODY (text) ---');
    console.log(text || '(no text body)');
    console.log('================================================\n');
    return { id: 'dev-mode-no-send' };
  }

  const resend = getResend();
  const result = await resend.emails.send({ from: FROM, to, subject, html, text });
  if (result.error) throw new Error('Resend error: ' + result.error.message);
  return result;
}

// ── Password invite (new workspace member) ────────────────────
async function sendInvitePasswordEmail({ to, name, username, password, workspaceName, workspaceSlug, loginUrl }) {
  const subject = 'Your ' + workspaceName + ' login credentials — ' + APP_NAME;
  const text = [
    'Hi ' + name + ',',
    '',
    'You have been added to ' + workspaceName + ' on ' + APP_NAME + '.',
    '',
    'Username:           ' + username,
    'Temporary Password: ' + password,
    '',
    'Login at: ' + loginUrl,
    '',
    'You will be required to change your password on first login.',
    '',
    '— ' + APP_NAME
  ].join('\n');

  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0f1115;color:#e5e7eb;padding:36px;border-radius:12px">'
    + '<h2 style="color:#3b82f6;margin-top:0">Welcome to ' + esc(workspaceName) + '</h2>'
    + '<p>Hi ' + esc(name) + ',</p>'
    + '<p>You have been added to <strong>' + esc(workspaceName) + '</strong> on ' + esc(APP_NAME) + '.</p>'
    + '<div style="background:#1c1f26;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #3b82f6">'
    + '<p style="margin:4px 0"><strong>Username:</strong> ' + esc(username) + '</p>'
    + '<p style="margin:4px 0"><strong>Temporary Password:</strong> <code style="background:#0f1115;padding:2px 8px;border-radius:4px;font-size:14px">' + esc(password) + '</code></p>'
    + '</div>'
    + '<p style="color:#9ca3af;font-size:14px">You will be asked to change your password on first login.</p>'
    + '<a href="' + loginUrl + '" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Login Now</a>'
    + '<p style="margin-top:32px;color:#4b5563;font-size:12px">' + esc(APP_NAME) + ' · Temperature Compliance</p>'
    + '</div>';

  return sendMail({ to, subject, html, text });
}

// ── Google invite ─────────────────────────────────────────────
async function sendGoogleInviteEmail({ to, name, workspaceName, loginUrl }) {
  const subject = 'You have been invited to ' + workspaceName + ' — ' + APP_NAME;
  const text = [
    'Hi ' + name + ',',
    '',
    'You have been invited to ' + workspaceName + ' on ' + APP_NAME + '.',
    '',
    'Sign in with your Google account at: ' + loginUrl,
    '',
    '— ' + APP_NAME
  ].join('\n');

  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0f1115;color:#e5e7eb;padding:36px;border-radius:12px">'
    + '<h2 style="color:#3b82f6;margin-top:0">You are invited to ' + esc(workspaceName) + '</h2>'
    + '<p>Hi ' + esc(name) + ',</p>'
    + '<p>You have been invited to <strong>' + esc(workspaceName) + '</strong> on ' + esc(APP_NAME) + '.</p>'
    + '<p>Click below and sign in with your Google account (<strong>' + esc(to) + '</strong>).</p>'
    + '<a href="' + loginUrl + '" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Sign in with Google</a>'
    + '<p style="margin-top:32px;color:#4b5563;font-size:12px">' + esc(APP_NAME) + ' · Temperature Compliance</p>'
    + '</div>';

  return sendMail({ to, subject, html, text });
}

// ── Compliance export email ───────────────────────────────────
async function sendExportEmail({ to, workspaceName, periodStart, periodEnd, downloadUrl }) {
  const subject = workspaceName + ' — Compliance Export ' + periodStart + ' to ' + periodEnd;
  const text = [
    'Compliance Export — ' + workspaceName,
    'Period: ' + periodStart + ' to ' + periodEnd,
    '',
    'Download: ' + downloadUrl,
    '',
    '— ' + APP_NAME
  ].join('\n');

  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0f1115;color:#e5e7eb;padding:36px;border-radius:12px">'
    + '<h2 style="color:#3b82f6;margin-top:0">Compliance Export</h2>'
    + '<p><strong>' + esc(workspaceName) + '</strong></p>'
    + '<p>Period: ' + esc(periodStart) + ' to ' + esc(periodEnd) + '</p>'
    + '<a href="' + downloadUrl + '" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Download ZIP</a>'
    + '<p style="margin-top:32px;color:#4b5563;font-size:12px">' + esc(APP_NAME) + ' · Temperature Compliance</p>'
    + '</div>';

  return sendMail({ to, subject, html, text });
}

// ── Ownership transfer notification ──────────────────────────
async function sendOwnershipTransferEmail({ to, name, workspaceName, newOwnerName, loginUrl }) {
  const subject = workspaceName + ' — Ownership Transferred';
  const text = [
    'Hi ' + name + ',',
    '',
    'The ownership of ' + workspaceName + ' on ' + APP_NAME + ' has been transferred to ' + newOwnerName + '.',
    '',
    'Your account remains active as a member of the workspace.',
    '',
    'Login: ' + loginUrl,
    '',
    '— ' + APP_NAME
  ].join('\n');

  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0f1115;color:#e5e7eb;padding:36px;border-radius:12px">'
    + '<h2 style="color:#f59e0b;margin-top:0">Ownership Transferred</h2>'
    + '<p>Hi ' + esc(name) + ',</p>'
    + '<p>Ownership of <strong>' + esc(workspaceName) + '</strong> has been transferred to <strong>' + esc(newOwnerName) + '</strong>.</p>'
    + '<p style="color:#9ca3af;font-size:14px">Your account remains active as a member of the workspace.</p>'
    + '<a href="' + loginUrl + '" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Go to Workspace</a>'
    + '<p style="margin-top:32px;color:#4b5563;font-size:12px">' + esc(APP_NAME) + ' · Temperature Compliance</p>'
    + '</div>';

  return sendMail({ to, subject, html, text });
}

// ── Exception / alert email ───────────────────────────────────
async function sendExceptionEmail({ to, workspaceName, exceptions }) {
  if (process.env.EXCEPTION_EMAIL_ENABLED !== 'true') return;
  const subject = workspaceName + ' — Temperature Exception Alert';
  const lines = exceptions.map(function(e) {
    return '• [' + e.severity.toUpperCase() + '] ' + e.vehicle + ': ' + e.description;
  }).join('\n');
  const text = ['Exception Alert — ' + workspaceName, '', lines, '', '— ' + APP_NAME].join('\n');
  const listHtml = exceptions.map(function(e) {
    const color = e.severity === 'critical' ? '#ef4444' : e.severity === 'warning' ? '#f59e0b' : '#6b7280';
    return '<li style="margin:8px 0"><span style="color:' + color + ';font-weight:bold">[' + esc(e.severity.toUpperCase()) + ']</span> <strong>' + esc(e.vehicle) + '</strong>: ' + esc(e.description) + '</li>';
  }).join('');
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0f1115;color:#e5e7eb;padding:36px;border-radius:12px">'
    + '<h2 style="color:#ef4444;margin-top:0">Exception Alert</h2>'
    + '<p><strong>' + esc(workspaceName) + '</strong></p>'
    + '<ul style="padding-left:20px">' + listHtml + '</ul>'
    + '<p style="margin-top:32px;color:#4b5563;font-size:12px">' + esc(APP_NAME) + ' · Temperature Compliance</p>'
    + '</div>';
  return sendMail({ to, subject, html, text });
}

// ── XSS escaping for HTML emails ─────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  sendMail,
  sendInvitePasswordEmail,
  sendGoogleInviteEmail,
  sendExportEmail,
  sendOwnershipTransferEmail,
  sendExceptionEmail
};