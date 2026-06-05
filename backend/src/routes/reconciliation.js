const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAdmin } = require('../middleware/auth');

// Format date as DD-MM-YYYY to avoid Excel MM/DD confusion
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function fmtDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

// Fix 3: status no longer requires session to be ended
function computeBinStatus(matched, expected, variance, sessionEnded) {
  if (matched === 0 && variance === 0) return 'Pending';
  if (matched === expected && variance === 0) return 'Complete';
  if (matched > expected) return 'Excess';
  if (variance > 0 && matched < expected) return 'Variance';
  if (variance > 0) return 'Variance';
  if (!sessionEnded && matched > 0 && matched < expected) return 'Scanning';
  return 'Short';
}

async function buildReconciliation(warehouseFilter, statusFilter, dateFrom, dateTo) {
  const inventoryWhere = warehouseFilter ? { locationCode: warehouseFilter } : {};

  // Fetch all inventory bins (count + lpnBoxId)
  const [allBins, lpnBoxIdRows] = await Promise.all([
    prisma.inventory.groupBy({
      by: ['locationCode', 'binCode'],
      where: inventoryWhere,
      _count: { id: true },
    }),
    prisma.inventory.findMany({
      where: inventoryWhere,
      select: { locationCode: true, binCode: true, lpnBoxId: true },
      distinct: ['locationCode', 'binCode'],
    }),
  ]);

  const lpnBoxIdMap = {};
  for (const r of lpnBoxIdRows) {
    lpnBoxIdMap[`${r.locationCode}::${r.binCode}`] = r.lpnBoxId || null;
  }

  // Date filter — applied only to determine which sessions to consider for "latest session" display
  const sessionDateFilter = {};
  if (dateFrom) sessionDateFilter.gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    sessionDateFilter.lte = end;
  }
  const hasDateFilter = Object.keys(sessionDateFilter).length > 0;

  // Bulk fetch ALL sessions and scans for efficiency
  const allSessions = await prisma.auditSession.findMany({
    where: warehouseFilter ? { warehouse: warehouseFilter } : {},
    orderBy: { startTime: 'desc' },
  });

  const sessionIds = allSessions.map(s => s.id);
  const allScans = sessionIds.length > 0
    ? await prisma.scannedDevice.findMany({ where: { sessionId: { in: sessionIds } } })
    : [];

  const allCorrections = await prisma.correction.findMany({
    where: warehouseFilter ? { warehouse: warehouseFilter } : {},
    orderBy: { correctedAt: 'desc' },
  });

  // Group sessions by warehouse
  const sessionsByWH = {};
  for (const s of allSessions) {
    if (!sessionsByWH[s.warehouse]) sessionsByWH[s.warehouse] = [];
    sessionsByWH[s.warehouse].push(s);
  }

  // Group scans by sessionId+binCode
  const scansBySessionBin = {};
  for (const scan of allScans) {
    const key = `${scan.sessionId}::${scan.binCode}`;
    if (!scansBySessionBin[key]) scansBySessionBin[key] = [];
    scansBySessionBin[key].push(scan);
  }

  // Group corrections by warehouse+bin
  const correctionsByBin = {};
  for (const c of allCorrections) {
    const key = `${c.warehouse}::${c.binCode}`;
    if (!correctionsByBin[key]) correctionsByBin[key] = c;
  }

  const rows = allBins.map(({ locationCode, binCode, _count }) => {
      const expected = _count.id;
      const whSessions = sessionsByWH[locationCode] || [];

      // Latest session overall (for sessionEnded status — not date-filtered)
      const latestSessionOverall = whSessions[0] || null;

      // Sessions within date filter
      const sessionsInRange = hasDateFilter
        ? whSessions.filter(s => {
            const t = new Date(s.startTime);
            if (sessionDateFilter.gte && t < sessionDateFilter.gte) return false;
            if (sessionDateFilter.lte && t > sessionDateFilter.lte) return false;
            return true;
          })
        : whSessions;

      // Aggregate ALL scans for this bin across ALL sessions (cross-session logic)
      const allBinScans = whSessions.flatMap(s => scansBySessionBin[`${s.id}::${binCode}`] || []);

      // Matched = unique serial numbers matched across ALL sessions (cumulative, deduped)
      const matchedSerials = new Set(
        allBinScans.filter(s => s.matched && s.serialNo).map(s => s.serialNo.toUpperCase())
      );
      const matched = matchedSerials.size;
      const remaining = Math.max(0, expected - matched);

      // Audit date & auditor = latest session in range that ACTUALLY scanned this bin
      const latestSessionForBin = sessionsInRange.find(s =>
        (scansBySessionBin[`${s.id}::${binCode}`] || []).length > 0
      ) || null;

      // Variance = only from the LATEST session for this bin (not accumulated across sessions)
      // This ensures a clean re-audit correctly resets variance to 0
      const latestSessionScans = latestSessionForBin
        ? (scansBySessionBin[`${latestSessionForBin.id}::${binCode}`] || [])
        : [];
      const variance = latestSessionScans.filter(s => !s.matched).length;
      const totalScanned = matched + variance;

      // Use the actual latest session (not date-filtered) to determine if bin is locked
      const sessionEnded = latestSessionOverall ? !!latestSessionOverall.endTime : false;
      const status = computeBinStatus(matched, expected, variance, sessionEnded);
      const correction = correctionsByBin[`${locationCode}::${binCode}`] || null;

      return {
        warehouse: locationCode, bin: binCode, expected,
        matched, variance, totalScanned, remaining,
        lpnBoxId: lpnBoxIdMap[`${locationCode}::${binCode}`] || null,
        originalStatus: status,
        finalStatus: correction ? 'Corrected' : status,
        reauditVariance: latestSessionForBin?.isReaudit ? variance : null,
        reauditBy: latestSessionForBin?.isReaudit ? latestSessionForBin.auditorEmail : null,
        auditor: latestSessionForBin?.auditorEmail || null,
        correction,
        // Only show audit date if this bin was actually scanned
        sessionDate: latestSessionForBin?.startTime || null,
      };
    });

  const filtered = statusFilter
    ? rows.filter(r => r.finalStatus === statusFilter || r.originalStatus === statusFilter)
    : rows;

  // If date filter active, exclude bins with no matching session
  return dateFrom || dateTo
    ? filtered.filter(r => r.sessionDate !== null)
    : filtered;
}

// GET /api/reconciliation
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status, date_from, date_to } = req.query;
    const data = await buildReconciliation(warehouse, status, date_from, date_to);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/export
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status, date_from, date_to } = req.query;
    const data = await buildReconciliation(warehouse, status, date_from, date_to);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `reconciliation_${today}.csv`;

    const headers = [
      'Warehouse', 'Bin', 'LPN/Box ID', 'Audit Date', 'Expected', 'Matched', 'Variance',
      'Remaining', 'Total Scanned', 'Original Status', 'Final Status',
      'Re-audit Variance', 'Re-audit By', 'Auditor', 'Correction Remark',
    ];

    const csvRows = [
      headers.join(','),
      ...data.map(r =>
        [
          r.warehouse, r.bin, r.lpnBoxId ?? '',
          r.sessionDate ? fmtDate(r.sessionDate) : '',
          r.expected, r.matched, r.variance, r.remaining, r.totalScanned,
          r.originalStatus, r.finalStatus,
          r.reauditVariance ?? '', r.reauditBy ?? '', r.auditor ?? '',
          r.correction ? `"${r.correction.remark}"` : '',
        ].join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/export-detailed — device-level CSV export (optimized, plain text)
router.get('/export-detailed', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status, date_from, date_to } = req.query;

    // Build date filter once
    const sessionDateFilter = {};
    if (date_from) sessionDateFilter.gte = new Date(date_from);
    if (date_to) { const e = new Date(date_to); e.setHours(23, 59, 59, 999); sessionDateFilter.lte = e; }
    const hasDateFilter = Object.keys(sessionDateFilter).length > 0;

    // Fetch everything in 3 bulk queries
    const [allInventory, allSessions] = await Promise.all([
      prisma.inventory.findMany({ where: warehouse ? { locationCode: warehouse } : {} }),
      prisma.auditSession.findMany({
        where: {
          ...(warehouse ? { warehouse } : {}),
          ...(hasDateFilter ? { startTime: sessionDateFilter } : {}),
        },
        select: { id: true, startTime: true, auditorEmail: true, warehouse: true, endTime: true },
      }),
    ]);

    const sessionIds = allSessions.map(s => s.id);
    const sessionMap = Object.fromEntries(allSessions.map(s => [s.id, s]));

    const allScans = sessionIds.length > 0
      ? await prisma.scannedDevice.findMany({ where: { sessionId: { in: sessionIds } } })
      : [];

    // Group by warehouse::bin
    const invByBin = {};
    for (const inv of allInventory) {
      const key = `${inv.locationCode}::${inv.binCode}`;
      if (!invByBin[key]) invByBin[key] = [];
      invByBin[key].push(inv);
    }

    const scansByBin = {};
    for (const scan of allScans) {
      const sess = sessionMap[scan.sessionId];
      if (!sess) continue;
      const key = `${sess.warehouse}::${scan.binCode}`;
      if (!scansByBin[key]) scansByBin[key] = [];
      scansByBin[key].push(scan);
    }

    const headers = [
      'Warehouse', 'Bin', 'LPN/Box ID', 'Audit Date', 'Bin Status', 'Device Status',
      'Serial No', 'Mac ID', 'Device ID', 'Description', 'Type (No2)',
      'Inventory Type', 'Scan Type', 'Scanned At', 'Auditor',
    ];

    // BOM for Excel UTF-8
    const csvRows = ['﻿' + headers.join(',')];

    const allBinKeys = new Set([...Object.keys(invByBin), ...Object.keys(scansByBin)]);

    for (const binKey of allBinKeys) {
      const [wh, bin] = binKey.split('::');
      const inventoryRows = invByBin[binKey] || [];
      const scans = scansByBin[binKey] || [];

      const matchedSerials = new Set(scans.filter(s => s.matched).map(s => (s.serialNo || '').toUpperCase()));
      const matched = matchedSerials.size;
      const variance = scans.filter(s => !s.matched).length;
      const expected = inventoryRows.length;

      const latestSess = allSessions
        .filter(s => s.warehouse === wh)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];

      const binStatus = computeBinStatus(matched, expected, variance, !!latestSess?.endTime);

      if (status && binStatus !== status) continue;

      const auditDate = latestSess ? fmtDate(latestSess.startTime) : '';
      const lpnBoxId = inventoryRows[0]?.lpnBoxId || '';

      // 1. Matched
      for (const scan of scans.filter(s => s.matched)) {
        const sess = sessionMap[scan.sessionId];
        const inv = inventoryRows.find(r => r.serialNo && r.serialNo.toUpperCase() === (scan.serialNo || '').toUpperCase());
        csvRows.push([
          wh, bin, lpnBoxId, auditDate, binStatus, 'Matched',
          scan.serialNo || '', scan.macId || '', scan.deviceId || '',
          `"${(inv?.description || '').replace(/"/g, '""')}"`,
          inv?.no2 || '', inv?.inventory || '',
          scan.scanType || '', fmtDateTime(scan.scannedAt),
          sess?.auditorEmail || '',
        ].join(','));
      }

      // 2. Missing
      for (const inv of inventoryRows) {
        if (!inv.serialNo || matchedSerials.has(inv.serialNo.toUpperCase())) continue;
        csvRows.push([
          wh, bin, lpnBoxId, auditDate, binStatus, 'Missing',
          inv.serialNo || '', inv.macId || '', inv.deviceId || '',
          `"${(inv.description || '').replace(/"/g, '""')}"`,
          inv.no2 || '', inv.inventory || '',
          '', '', '',
        ].join(','));
      }

      // 3. Variance
      for (const scan of scans.filter(s => !s.matched)) {
        const sess = sessionMap[scan.sessionId];
        csvRows.push([
          wh, bin, lpnBoxId, auditDate, binStatus, 'Variance',
          scan.extractedSerial || '', '', '', '', '', '',
          scan.scanType || '', fmtDateTime(scan.scannedAt),
          sess?.auditorEmail || '',
        ].join(','));
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation_detailed_${today}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/daily-stats — per-day aggregated metrics
router.get('/daily-stats', requireAdmin, async (req, res) => {
  try {
    const { warehouse, date_from, date_to } = req.query;

    const where = {};
    if (warehouse) where.warehouse = warehouse;
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(date_from);
      if (date_to) {
        const end = new Date(date_to);
        end.setHours(23, 59, 59, 999);
        where.startTime.lte = end;
      }
    }

    const sessions = await prisma.auditSession.findMany({
      where,
      include: { _count: { select: { scans: true } } },
      orderBy: { startTime: 'asc' },
    });

    // Group by calendar date (YYYY-MM-DD) and auditor
    const byDate = {};
    for (const s of sessions) {
      const day = new Date(s.startTime).toISOString().slice(0, 10);
      if (!byDate[day]) byDate[day] = { sessions: [], auditorScans: {} };
      byDate[day].sessions.push(s);
      const email = s.auditorEmail;
      byDate[day].auditorScans[email] = (byDate[day].auditorScans[email] || 0) + s._count.scans;
    }

    // For each day get the bin-level data from reconciliation
    const reconData = await buildReconciliation(warehouse, null, date_from, date_to);
    const binsByDate = {};
    for (const r of reconData) {
      if (!r.sessionDate) continue;
      const day = new Date(r.sessionDate).toISOString().slice(0, 10);
      if (!binsByDate[day]) binsByDate[day] = [];
      binsByDate[day].push(r);
    }

    const allDays = [...new Set([...Object.keys(byDate), ...Object.keys(binsByDate)])].sort();

    const result = allDays.map(day => {
      const dayBins = binsByDate[day] || [];
      const total = dayBins.length;
      const complete = dayBins.filter(r => r.finalStatus === 'Complete' || r.finalStatus === 'Corrected').length;
      const discrepancy = dayBins.filter(r => ['Short', 'Excess', 'Variance'].includes(r.finalStatus)).length;
      const daySessions = byDate[day]?.sessions || [];
      const auditorScans = byDate[day]?.auditorScans || {};

      return {
        date: day,
        totalAudits: total,
        completionRate: total > 0 ? Math.round((complete / total) * 100) : 0,
        discrepancyRate: total > 0 ? Math.round((discrepancy / total) * 100) : 0,
        totalSessions: daySessions.length,
        auditorScans,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/auditor-stats — per-auditor performance metrics
router.get('/auditor-stats', requireAdmin, async (req, res) => {
  try {
    const { warehouse, date_from, date_to } = req.query;

    const [assignments, reconData] = await Promise.all([
      prisma.assignment.findMany({ where: warehouse ? { warehouse } : {} }),
      buildReconciliation(warehouse, null, date_from, date_to),
    ]);

    // Map bin status by warehouse::binCode
    const statusMap = {};
    for (const r of reconData) {
      statusMap[`${r.warehouse}::${r.bin}`] = r;
    }

    // Aggregate per auditor
    const auditorMap = {};
    for (const a of assignments) {
      const email = a.assignedTo;
      if (!auditorMap[email]) {
        auditorMap[email] = { email, assigned: 0, completed: 0, discrepancy: 0, scanning: 0, pending: 0 };
      }
      auditorMap[email].assigned++;
      const rec = statusMap[`${a.warehouse}::${a.binCode}`];
      if (!rec || rec.finalStatus === 'Pending') auditorMap[email].pending++;
      else if (rec.finalStatus === 'Scanning') auditorMap[email].scanning++;
      else if (rec.finalStatus === 'Complete' || rec.finalStatus === 'Corrected') auditorMap[email].completed++;
      else auditorMap[email].discrepancy++; // Short / Excess / Variance
    }

    const result = Object.values(auditorMap)
      .map(a => ({
        ...a,
        accuracyRate: a.assigned > 0 ? Math.round((a.completed / a.assigned) * 100) : 0,
      }))
      .sort((a, b) => b.assigned - a.assigned);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/bin-detail/:warehouse/:binCode — full drill-down for one bin
router.get('/bin-detail/:warehouse/:binCode', requireAdmin, async (req, res) => {
  try {
    const { warehouse, binCode } = req.params;

    const [inventory, sessions] = await Promise.all([
      prisma.inventory.findMany({ where: { locationCode: warehouse, binCode }, orderBy: { serialNo: 'asc' } }),
      prisma.auditSession.findMany({ where: { warehouse }, orderBy: { startTime: 'desc' } }),
    ]);

    const sessionIds = sessions.map(s => s.id);
    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

    const allScans = sessionIds.length > 0
      ? await prisma.scannedDevice.findMany({ where: { sessionId: { in: sessionIds }, binCode }, orderBy: { scannedAt: 'desc' } })
      : [];

    // Deduped matched scans (first scan wins per serial)
    const matchedSerialSet = new Set();
    const matched = [];
    for (const scan of allScans.filter(s => s.matched)) {
      const key = (scan.serialNo || '').toUpperCase();
      if (key && !matchedSerialSet.has(key)) {
        matchedSerialSet.add(key);
        matched.push({ ...scan, auditorEmail: sessionMap[scan.sessionId]?.auditorEmail });
      }
    }

    // Missing: in inventory but serial never matched
    const missing = inventory.filter(inv =>
      !inv.serialNo || !matchedSerialSet.has(inv.serialNo.toUpperCase())
    );

    // Variance: scanned but didn't match inventory
    const variance = allScans
      .filter(s => !s.matched)
      .map(s => ({ ...s, auditorEmail: sessionMap[s.sessionId]?.auditorEmail }));

    const lpnBoxId = inventory[0]?.lpnBoxId || null;
    res.json({ warehouse, binCode, expected: inventory.length, lpnBoxId, matched, missing, variance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/sessions-history — all audit sessions with date filter
router.get('/sessions-history', requireAdmin, async (req, res) => {
  try {
    const { warehouse, date_from, date_to } = req.query;
    const where = {};
    if (warehouse) where.warehouse = warehouse;
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(date_from);
      if (date_to) {
        const end = new Date(date_to);
        end.setHours(23, 59, 59, 999);
        where.startTime.lte = end;
      }
    }
    const sessions = await prisma.auditSession.findMany({
      where,
      include: { _count: { select: { scans: true } } },
      orderBy: { startTime: 'desc' },
    });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
