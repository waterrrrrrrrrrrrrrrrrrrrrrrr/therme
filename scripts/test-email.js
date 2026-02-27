#!/usr/bin/env node
// scripts/test-email.js — Send a test email via Resend to verify configuration
// Usage: node scripts/test-email.js your@email.com
'use strict';

require('dotenv').config();

const recipient = process.argv[2];
if (!recipient) {
  console.error('Usage: node scripts/test-email.js your@email.com');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error('ERROR: RESEND_API_KEY is not set in .env');
  console.error('Set it and try again.');
  process.exit(1);
}

const APP_NAME = process.env.APP_NAME || 'Thermio';
const FROM     = process.env.MAIL_FROM || 'noreply@loveri.ng';

async function main() {
  console.log('');
  console.log('=== THERMIO EMAIL TEST ===');
  console.log(`API Key : ${process.env.RESEND_API_KEY ? '[SET]' : '[MISSING]'}`);
  console.log(`From    : ${FROM}`);
  console.log(`To      : ${recipient}`);
  console.log('');

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  console.log('Sending test email via Resend...');

  const result = await resend.emails.send({
    from: FROM,
    to: recipient,
    subject: `${APP_NAME} — Email Test`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0f1115;color:#e5e7eb;padding:32px;border-radius:12px">
        <h2 style="color:#3b82f6;margin-top:0">Email Test Successful</h2>
        <p>This is a test email from <strong>${APP_NAME}</strong>.</p>
        <p>If you received this, your Resend configuration is working correctly.</p>
        <div style="background:#1c1f26;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:4px 0;font-size:13px;color:#9ca3af">Sent from: ${FROM}</p>
          <p style="margin:4px 0;font-size:13px;color:#9ca3af">App: ${APP_NAME}</p>
          <p style="margin:4px 0;font-size:13px;color:#9ca3af">Time: ${new Date().toISOString()}</p>
        </div>
        <p style="color:#4b5563;font-size:12px;margin-top:24px">${APP_NAME} · Temperature Compliance</p>
      </div>
    `,
    text: [
      `${APP_NAME} — Email Test`,
      '',
      'If you received this, your Resend configuration is working correctly.',
      '',
      `From: ${FROM}`,
      `Time: ${new Date().toISOString()}`,
      '',
      `— ${APP_NAME}`
    ].join('\n')
  });

  if (result.error) {
    console.error('');
    console.error('SEND FAILED:');
    console.error(result.error);
    console.error('');
    console.error('Common causes:');
    console.error('  1. RESEND_API_KEY is wrong or expired');
    console.error('  2. MAIL_FROM domain is not verified in Resend');
    console.error('  3. DNS records (SPF/DKIM) not propagated yet');
    process.exit(1);
  }

  console.log('');
  console.log('SUCCESS! Email sent.');
  console.log(`Message ID: ${result.data && result.data.id || result.id}`);
  console.log('');
  console.log('Check your inbox (and spam folder).');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Confirm the email arrives with correct formatting');
  console.log('  2. Check the "From" name shows as expected');
  console.log('  3. Verify it passes SPF/DKIM checks (check email headers)');
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
