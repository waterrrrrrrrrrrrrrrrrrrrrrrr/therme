#!/usr/bin/env node
// scripts/create-superadmin.js
// Creates or replaces the Portal Admin (superadmin) account.
// Usage: node scripts/create-superadmin.js
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const BCRYPT_ROUNDS = 14;

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function validatePassword(pw) {
  const errors = [];
  if (!pw || pw.length < 8)       errors.push('At least 8 characters');
  if (!/[A-Z]/.test(pw))          errors.push('At least 1 uppercase letter (A–Z)');
  if (!/[0-9]/.test(pw))          errors.push('At least 1 number (0–9)');
  if (!/[^A-Za-z0-9]/.test(pw))   errors.push('At least 1 special character (e.g. !@#$%)');
  return errors;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let pw = '';
    stdin.on('data', function handler(ch) {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(pw);
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit();
      } else if (ch === '\u007f' || ch === '\b') {
        if (pw.length > 0) {
          pw = pw.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        pw += ch;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n  Thermio — Portal Admin Setup');
  console.log('  ─────────────────────────────────\n');

  const username = (await ask('  Username: ')).trim();
  if (!username) {
    console.error('  Error: Username cannot be empty.');
    process.exit(1);
  }

  let password;
  while (true) {
    password = await askHidden('  Password: ');
    const errors = validatePassword(password);
    if (errors.length === 0) break;
    console.log('\n  Password does not meet requirements:');
    errors.forEach(e => console.log(`    • ${e}`));
    console.log('');
  }

  const confirm = await askHidden('  Confirm password: ');
  if (password !== confirm) {
    console.error('\n  Error: Passwords do not match.');
    process.exit(1);
  }

  rl.close();

  console.log('\n  Hashing password...');
  let hash;
  try {
    hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  } catch (err) {
    console.error('  Error: Password hashing failed.', err.message);
    process.exit(1);
  }

  const users = readUsers();
  const existingIdx = users.findIndex(u => u.role === 'superadmin');

  const adminUser = {
    id: existingIdx >= 0 ? users[existingIdx].id : uuidv4(),
    username,
    name: 'Portal Admin',
    role: 'superadmin',
    workspaceId: null,
    passwordHash: hash,
    mustChangePassword: false,
    active: true,
    createdAt: existingIdx >= 0 ? users[existingIdx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    users[existingIdx] = adminUser;
    console.log('  Updated existing Portal Admin account.');
  } else {
    users.push(adminUser);
    console.log('  Created new Portal Admin account.');
  }

  writeUsers(users);

  console.log(`\n  Portal Admin ready.`);
  console.log(`  Username : ${username}`);
  console.log(`  Login at : /portal/login\n`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
