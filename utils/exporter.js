// utils/exporter.js — PDF + ZIP export generation
'use strict';

const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const TempLogRepo = require('../repositories/TempLogRepo');
const VehicleRepo = require('../repositories/VehicleRepo');
const UserRepo = require('../repositories/UserRepo');
const ExportRepo = require('../repositories/ExportRepo');
const { sendExportEmail } = require('./mailer');
const { getMonday, getSignOffDateOfWeek } = require('./helpers');

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');
const PDF_DIR = path.join(EXPORTS_DIR, 'pdfs');
const ZIP_DIR = path.join(EXPORTS_DIR, 'zips');

// Ensure directories exist
[PDF_DIR, ZIP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

async function generateExport(workspace, exportRecord, periodStart, periodEnd) {
  const s = workspace && workspace.settings && workspace.settings.signoff;
  const signoffDay = (s && s.dayOfWeek != null) ? Number(s.dayOfWeek) : (parseInt(process.env.SIGNOFF_DAY) || 5);

  // Get all logs in the period
  const allLogs = TempLogRepo.getByWorkspaceDateRange(workspace.id, periodStart, periodEnd);
  const vehicles = VehicleRepo.getAllByWorkspace(workspace.id);
  const allUsers = UserRepo.getAllByWorkspace(workspace.id);

  // Group by vehicle + week
  const vehicleWeeks = {};
  allLogs.forEach(log => {
    const monday = getMonday(log.date);
    const key = `${log.truck_id}_${monday}`;
    if (!vehicleWeeks[key]) vehicleWeeks[key] = { vehicleId: log.truck_id, monday };
  });

  // Generate one PDF per vehicle-week
  const pdfPaths = [];
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.warn('Puppeteer not available — PDFs will be skipped. Run: npm install puppeteer');
    puppeteer = null;
  }

  for (const [key, { vehicleId, monday }] of Object.entries(vehicleWeeks)) {
    const truck = vehicles.find(v => v.id === vehicleId);
    if (!truck) continue;

    const signOffDate = getSignOffDateOfWeek(monday, signoffDay);
    const weekLogs = allLogs.filter(l => l.truck_id === vehicleId && l.date >= monday && l.date <= signOffDate);
    const signOffLog = weekLogs.find(l => l.date === signOffDate);
    if (signOffLog) {
      const driver = allUsers.find(u => u.id === signOffLog.driver_id);
      signOffLog.driverName = driver ? driver.name : '';
    }

    const dayNames = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const dayMap = {};
    weekLogs.forEach(log => {
      const dayName = new Date(log.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long' }).toUpperCase();
      const driver = allUsers.find(u => u.id === log.driver_id);
      dayMap[dayName] = { ...log, driverName: driver ? driver.name : '' };
    });

    if (puppeteer) {
      const html = buildSheetHtml(truck, monday, dayNames, dayMap, signOffLog, workspace);
      const pdfFilename = `${workspace.slug}_${truck.rego.replace(/[^a-zA-Z0-9]/g, '')}_${monday}.pdf`;
      const pdfPath = path.join(PDF_DIR, pdfFilename);

      const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true });
      await browser.close();
      pdfPaths.push(pdfPath);
    }
  }

  // Create ZIP
  const zipFilename = `${workspace.slug}_export_${periodStart}_to_${periodEnd}_${Date.now()}.zip`;
  const zipPath = path.join(ZIP_DIR, zipFilename);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    pdfPaths.forEach(pdfPath => {
      archive.file(pdfPath, { name: path.basename(pdfPath) });
    });
    archive.finalize();
  });

  // Relative path for storage
  const relativeZipPath = path.join('exports', 'zips', zipFilename);

  ExportRepo.markComplete(exportRecord.id, workspace.id, {
    pdfPaths: pdfPaths.map(p => path.relative(path.join(__dirname, '..'), p)),
    zipPath: relativeZipPath
  });

  // Email to recipients
  const recipients = (workspace.exportSettings && workspace.exportSettings.recipients) || [];
  if (recipients.length > 0) {
    const downloadUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/app/exports/${exportRecord.id}/download`;
    for (const to of recipients) {
      try {
        await sendExportEmail({
          to,
          workspaceName: workspace.name,
          periodStart,
          periodEnd,
          zipPath,
          downloadUrl
        });
      } catch (e) {
        console.error(`Failed to send export email to ${to}:`, e.message);
      }
    }
    ExportRepo.markEmailed(exportRecord.id, workspace.id, { emailedTo: recipients });
  }

  return { pdfPaths, zipPath: relativeZipPath };
}

function buildSheetHtml(truck, monday, dayNames, dayMap, signOffLog, workspace) {
  const qs = workspace.checklistQuestions || [
    'Is the vehicle clean and free from contamination?',
    'Is the refrigeration unit operating correctly?',
    'Are all temperature loggers calibrated and working?',
    'Is the load secured and not exceeding capacity?',
    'Are all seals and door gaskets intact?'
  ];

  const checklistRows = qs.map(q => {
    const cells = dayNames.map(day => {
      const log = dayMap[day];
      if (!log || !log.checklist_done) return '<td style="text-align:center">—</td>';
      // Find the answer from checklist snapshot or old format
      const snap = log.checklistSnapshot || [];
      const snapEntry = snap.find(s => s.question === q);
      let answer = snapEntry ? snapEntry.answer : null;
      if (!answer) {
        // Legacy format — try q1..q5
        const qIdx = qs.indexOf(q);
        answer = log.checklist ? log.checklist[`q${qIdx+1}`] : null;
      }
      const symbol = answer === 'yes' ? '✓' : (answer === 'no' ? '✗' : '—');
      const color = answer === 'yes' ? '#22c55e' : (answer === 'no' ? '#ef4444' : '#888');
      return `<td style="text-align:center;color:${color};font-weight:bold;font-size:16px">${symbol}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 8px;font-size:11px">${q}</td>${cells}</tr>`;
  }).join('');

  const dayHeaders = dayNames.map(d => `<th>${d}</th>`).join('');
  const tempRows = [
    { label: 'Dispatch Time', key: null, sub: 'time' },
    { label: 'Chiller Temp', key: 'chiller' },
    { label: 'Freezer Temp', key: 'freezer' },
    ...Array.from({ length: 5 }, (_, i) => ({ label: `Cabin Temp ${i+1}`, key: 'cabin', tempIdx: i+1 }))
  ];

  const tempBody = [
    { label: 'Dispatch Time', fn: (log) => log && log.temps && log.temps[0] ? new Date(log.temps[0].time).toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }) : '—' },
    { label: 'Chiller °C', fn: (log) => log && log.temps && log.temps[0] ? (log.temps[0].chiller || '—') : '—' },
    { label: 'Freezer °C', fn: (log) => log && log.temps && log.temps[0] ? (log.temps[0].freezer || '—') : '—' },
  ];
  for (let i = 1; i <= 5; i++) {
    const idx = i;
    tempBody.push({ label: `Cabin ${idx} °C`, fn: (log) => {
      if (!log || !log.temps) return '—';
      const cabinTemps = log.temps.filter(t => t.type === 'cabin');
      return cabinTemps[idx-1] ? (cabinTemps[idx-1].cabin || '—') : '—';
    }});
  }

  const tempBodyRows = tempBody.map(row => {
    const cells = dayNames.map(day => {
      const log = dayMap[day];
      return `<td style="text-align:center;font-size:11px">${row.fn(log)}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 8px;font-size:11px">${row.label}</td>${cells}</tr>`;
  }).join('');

  const driverSig = signOffLog && signOffLog.signature
    ? `<img src="${signOffLog.signature}" style="max-height:50px;max-width:200px">`
    : '&nbsp;';
  const adminSig = signOffLog && signOffLog.admin_signature
    ? `<img src="${signOffLog.admin_signature}" style="max-height:50px;max-width:200px">`
    : '&nbsp;';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 12px; font-size: 11px; background: #fff; color: #000; }
  h2 { margin: 0 0 4px 0; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { border: 1px solid #333; padding: 4px 6px; }
  th { background: #1c1f26; color: #fff; font-size: 11px; text-align: center; }
  .section-title { font-weight: bold; font-size: 12px; margin: 8px 0 4px 0; }
  .sig-row { display: flex; gap: 40px; margin-top: 12px; }
  .sig-box { flex: 1; border-top: 2px solid #333; padding-top: 4px; font-size: 11px; }
</style>
</head>
<body>
  <h2>${workspace.name} — Temperature Sheet — ${truck.rego} (${truck.class})</h2>
  <p>Week of: <strong>${monday}</strong></p>

  <div class="section-title">Pre-Start Checklist</div>
  <table>
    <thead><tr><th style="text-align:left;min-width:220px">Question</th>${dayHeaders}</tr></thead>
    <tbody>${checklistRows}</tbody>
  </table>

  <div class="section-title">Temperature Log</div>
  <table>
    <thead><tr><th style="text-align:left;min-width:120px">Reading</th>${dayHeaders}</tr></thead>
    <tbody>${tempBodyRows}</tbody>
  </table>

  <div class="sig-row">
    <div class="sig-box">Driver Signature<br>${driverSig}<br>${signOffLog ? signOffLog.driverName || '' : ''}</div>
    <div class="sig-box">Admin Sign-off<br>${adminSig}<br>${signOffLog && signOffLog.admin_signed_by ? signOffLog.admin_signed_by : ''}</div>
    <div class="sig-box">Odometer: ${signOffLog && signOffLog.odometer ? signOffLog.odometer : '—'}</div>
  </div>
</body>
</html>`;
}

module.exports = { generateExport };
