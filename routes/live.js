// routes/live.js — Live page data

const TempLogRepo = require('../repositories/TempLogRepo');
const UserRepo = require('../repositories/UserRepo');
const VehicleRepo = require('../repositories/VehicleRepo');
const { getLiveStatus, formatTimeInTz, minutesAgoPerth, evaluateTempRanges } = require('../utils/helpers');

const DEFAULT_LIVE_WINDOW = 180;

// ws is the full workspace object (with ws.settings)
async function getLiveData(workspaceId, ws) {
  const settings = (ws && ws.settings) || {};
  const tz = settings.timezone || 'Australia/Perth';
  const overdueMinutes = settings.overdueMinutes || 120;
  const liveWindowMinutes = Math.max(overdueMinutes, DEFAULT_LIVE_WINDOW);
  const tempRanges = settings.tempRanges || null;

  const allUsers = await UserRepo.getAllByWorkspace(workspaceId);
  const vehicles = await VehicleRepo.getAllByWorkspace(workspaceId);
  const recentLogs = await TempLogRepo.getRecentByWorkspace(workspaceId, liveWindowMinutes);

  const byDriver = {};
  const byVehicle = {};

  for (const log of recentLogs) {
    const live = getLiveStatus(log, allUsers);
    if (!live) continue;

    const vehicle = vehicles.find(v => v.id === log.truck_id);
    const driver = allUsers.find(u => u.id === log.driver_id);

    const isOverdue = live.minutesAgo > overdueMinutes;
    const status = log.shift_done ? 'idle' : (isOverdue ? 'overdue' : 'active');

    // Evaluate last temp entry against workspace ranges
    const lastTempEntry = (log.temps || [])[log.temps.length - 1] || {};
    const tempAlerts = tempRanges ? evaluateTempRanges(lastTempEntry, tempRanges) : {};
    const hasAlert = Object.values(tempAlerts).some(v => v === 'low' || v === 'high');

    const entry = {
      logId: log.id,
      date: log.date,
      vehicle: vehicle ? { id: vehicle.id, rego: vehicle.rego, class: vehicle.class } : null,
      driver: driver ? { id: driver.id, name: driver.name, role: driver.role } : null,
      // People view
      name: driver ? driver.name : 'Unknown',
      vehicleRego: vehicle ? vehicle.rego : null,
      vehicleClass: vehicle ? vehicle.class : null,
      // Truck view
      rego: vehicle ? vehicle.rego : null,
      class: vehicle ? vehicle.class : null,
      driverName: driver ? driver.name : null,
      lastTemp: live.temp,
      lastLogTime: formatTimeInTz(live.time, tz),
      minutesAgo: live.minutesAgo,
      status,
      isOverdue,
      hasAlert,
      tempAlerts,
      isLive: live.minutesAgo <= liveWindowMinutes,
      checklistDone: log.checklist_done || false,
      shiftDone: log.shift_done || false,
      tempCount: (log.temps || []).length
    };

    const driverId = log.driver_id;
    if (!byDriver[driverId] || entry.minutesAgo < byDriver[driverId].minutesAgo) {
      byDriver[driverId] = entry;
    }
    const vehicleId = log.truck_id;
    if (!byVehicle[vehicleId] || entry.minutesAgo < byVehicle[vehicleId].minutesAgo) {
      byVehicle[vehicleId] = entry;
    }
  }

  const sortedByPeople = Object.values(byDriver).sort((a, b) => a.minutesAgo - b.minutesAgo);
  const sortedByTruck  = Object.values(byVehicle).sort((a, b) => a.minutesAgo - b.minutesAgo);
  const totalLive = sortedByPeople.filter(p => p.status === 'active' || p.status === 'overdue').length;

  return {
    byPeople: sortedByPeople,
    byTruck: sortedByTruck,
    totalLive,
    overdueMinutes,
    generatedAt: new Date().toLocaleTimeString('en-AU', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  };
}

module.exports = { getLiveData };
