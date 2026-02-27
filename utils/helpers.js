// utils/helpers.js — shared utility functions

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const PERTH_TZ = 'Australia/Perth';

// ── Timezone-aware date helpers ───────────────────────────────
// All functions accept an optional `tz` parameter (IANA string).
// When not provided, fall back to PERTH_TZ for backward compat.

function getTodayInTz(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz || PERTH_TZ });
}

function getPerthDate() {
  return getTodayInTz(PERTH_TZ);
}

function perthNow() {
  return new Date(new Date().toLocaleString('en-AU', { timeZone: PERTH_TZ }));
}

function formatTimeInTz(date, tz) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz || PERTH_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(date));
}

function formatPerthTime(date) {
  return formatTimeInTz(date, PERTH_TZ);
}

function minutesAgoPerth(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

function getMonday(dateString) {
  const d = new Date(dateString);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function getSignOffDateOfWeek(dateStr, signoffDay) {
  const monday = new Date(getMonday(dateStr));
  const daysToAdd = signoffDay === 0 ? 6 : signoffDay - 1;
  const targetDate = new Date(monday);
  targetDate.setDate(monday.getDate() + daysToAdd);
  return targetDate.toISOString().split('T')[0];
}

function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function extractTemps(temps) {
  const values = [];
  temps.forEach(t => {
    if (t.ambient != null && !isNaN(Number(t.ambient))) values.push(Number(t.ambient));
    if (t.chiller != null && !isNaN(Number(t.chiller))) values.push(Number(t.chiller));
    if (t.freezer != null && !isNaN(Number(t.freezer))) values.push(Number(t.freezer));
    if (t.cabin != null && !isNaN(Number(t.cabin))) values.push(Number(t.cabin));
  });
  return values;
}

function getLiveStatus(log, allUsers) {
  if (!log || log.shift_done) return null;
  if (!log.temps || log.temps.length === 0) return null;
  const last = log.temps[log.temps.length - 1];
  const temp = last.cabin ?? last.ambient ?? last.chiller ?? last.freezer ?? null;
  if (temp === null) return null;
  const driver = allUsers.find(s => s.id === log.driver_id);
  return {
    temp,
    time: new Date(last.time),
    perthTime: formatPerthTime(last.time),
    minutesAgo: minutesAgoPerth(last.time),
    driverName: driver ? driver.name : 'Unknown'
  };
}

function requiresAdminSignOff(log, signoffDay, forceSignoffDay = false) {
  if (!log) return false;
  const isSignOffDay = forceSignoffDay || (new Date(log.date + 'T12:00:00').getDay() === signoffDay);
  return (
    isSignOffDay &&
    log.shift_done === true &&
    !!log.odometer &&
    !!log.signature &&
    !log.admin_signature
  );
}

function generatePin() {
  return crypto.randomInt(100000, 1000000).toString();
}

function generatePassword(fixedLength) {
  // Random length 12–16 unless a fixed length is requested.
  // Guarantees: ≥1 uppercase, ≥2 digits, ≥2 special chars, ≥10 chars total.
  const length = fixedLength || (12 + crypto.randomInt(0, 5));
  const uppers   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers   = 'abcdefghjkmnpqrstuvwxyz';
  const digits   = '23456789';
  const specials = '!@#$%^&*';
  const all      = uppers + lowers + digits + specials;

  const mandatory = [
    uppers[crypto.randomInt(0, uppers.length)],
    digits[crypto.randomInt(0, digits.length)],
    digits[crypto.randomInt(0, digits.length)],
    specials[crypto.randomInt(0, specials.length)],
    specials[crypto.randomInt(0, specials.length)]
  ];

  const remaining = Math.max(0, length - mandatory.length);
  const rest = [];
  for (let i = 0; i < remaining; i++) {
    rest.push(all[crypto.randomInt(0, all.length)]);
  }

  const combined = [...mandatory, ...rest];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join('');
}

function generateUsername(firstName, lastName, existingUsernames) {
  if (!firstName) firstName = 'User';
  if (!lastName) lastName = '';
  const base = (firstName.trim() + (lastName.trim()[0] || '')).replace(/[^a-zA-Z0-9]/g, '');
  let candidate = base;
  let counter = 2;
  const lowerExisting = existingUsernames.map(u => u.toLowerCase());
  while (lowerExisting.includes(candidate.toLowerCase())) {
    candidate = base + counter;
    counter++;
  }
  return candidate;
}

function buildVehicleDayLabels(logs, users) {
  const map = {};
  logs.forEach(log => {
    const day = log.date;
    if (!day || map[day]) return;
    const driver = users.find(s => s.id === log.driver_id);
    map[day] = driver ? driver.name : 'UNKNOWN';
  });
  return map;
}

function buildStaffDayLabels(logs, vehicles) {
  const map = {};
  logs.forEach(log => {
    const day = log.date;
    if (!day) return;
    const vehicle = vehicles.find(v => v.id === log.truck_id);
    const key = `${day}_${log.truck_id}`;
    map[key] = vehicle ? vehicle.rego : 'UNKNOWN';
  });
  return map;
}

// ── Temperature range evaluation ─────────────────────────────
// tempRanges = { cabin:{min,max}, chiller:{min,max}, freezer:{min,max} }
// Returns { cabin:'ok'|'low'|'high'|null, chiller:..., freezer:... }
function evaluateTempRanges(tempEntry, tempRanges) {
  if (!tempRanges) return {};
  const result = {};
  const check = (val, zone) => {
    if (val === null || val === undefined || val === '') return null;
    const r = tempRanges[zone];
    if (!r) return null;
    const n = Number(val);
    if (isNaN(n)) return null;
    if (r.min !== null && r.min !== '' && n < Number(r.min)) return 'low';
    if (r.max !== null && r.max !== '' && n > Number(r.max)) return 'high';
    return 'ok';
  };
  result.dispatch = check(tempEntry.dispatch, 'chiller'); // dispatch = pre-load chiller
  result.chiller = check(tempEntry.chiller, 'chiller');
  result.freezer = check(tempEntry.freezer, 'freezer');
  result.cabin = check(tempEntry.cabin, 'cabin');
  return result;
}

// For a full log, returns true if any temp entry has any out-of-range value
function logHasOutOfRange(log, tempRanges) {
  if (!tempRanges || !log.temps) return false;
  return log.temps.some(t => {
    const r = evaluateTempRanges(t, tempRanges);
    return Object.values(r).some(v => v === 'low' || v === 'high');
  });
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function uuid() {
  return uuidv4();
}

module.exports = {
  getPerthDate,
  getTodayInTz,
  perthNow,
  formatPerthTime,
  formatTimeInTz,
  minutesAgoPerth,
  getMonday,
  getSignOffDateOfWeek,
  average,
  extractTemps,
  getLiveStatus,
  requiresAdminSignOff,
  evaluateTempRanges,
  logHasOutOfRange,
  generatePin,
  generatePassword,
  generateUsername,
  buildVehicleDayLabels,
  buildStaffDayLabels,
  slugify,
  uuid,
  PERTH_TZ
};
