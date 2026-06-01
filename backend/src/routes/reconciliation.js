const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAdmin } = require('../middleware/auth');

function computeBinStatus(matched, expected, variance, sessionEnded) {
  if (!sessionEnded) return 'Scanning';
  if (matched === expected && variance === 0) return 'Complete';
  if (matched > expected) return 'Excess';
  if (variance > 0) return 'Variance';
  return 'Short';
}

async function buildReconciliation(warehouseFilter, statusFilter, dateFrom, dateTo) {
  const inventoryWhere = warehouseFilter ? { locationCode: warehouseFilter } : {};

  const allBins = await prisma.inventory.groupBy({
    by: ['locationCode', 'binCode'],
    where: inventoryWhere,
    _count: { id: true },
  });

  // Date filter for sessions
  const sessionDateFilter = {};
  if (dateFrom) sessionDateFilter.gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    sessionDateFilter.lte = end;
  }
  const sessionWhere = Object.keys(sessionDateFilter).length > 0
    ? { startTime: sessionDateFilter }
    : {};

  const rows = await Promise.all(
    allBins.map(async ({ locationCode, binCode, _count }) => {
      const expected = _count.id;

      const latestSession = await prisma.auditSession.findFirst({
        where: { warehouse: locationCode, ...sessionWhere },
        orderBy: { startTime: 'desc' },
      });

      const corrections = await prisma.correction.findMany({
        where: { warehouse: locationCode, binCode },
        orderBy: { correctedAt: 'desc' },
        take: 1,
      });

      if (!latestSession) {
        return {
          warehouse: locationCode, bin: binCode, expected,
          matched: 0, variance: 0, totalScanned: 0, remaining: expected,
          originalStatus: 'Pending', finalStatus: 'Pending',
          reauditVariance: null, reauditBy: null, auditor: null,
          correction: corrections[0] || null,
          sessionDate: null,
        };
      }

      const scans = await prisma.scannedDevice.findMany({
        where: { sessionId: latestSession.id, binCode },
      });

      const matched = scans.filter(s => s.matched).length;
      const variance = scans.filter(s => !s.matched).length;
      const totalScanned = scans.length;
      const remaining = Math.max(0, expected - matched);
      const sessionEnded = !!latestSession.endTime;
      const status = computeBinStatus(matched, expected, variance, sessionEnded);

      return {
        warehouse: locationCode, bin: binCode, expected,
        matched, variance, totalScanned, remaining,
        originalStatus: status,
        finalStatus: corrections[0] ? 'Corrected' : status,
        reauditVariance: latestSession.isReaudit ? variance : null,
        reauditBy: latestSession.isReaudit ? latestSession.auditorEmail : null,
        auditor: latestSession.auditorEmail,
        correction: corrections[0] || null,
        sessionDate: latestSession.startTime,
      };
    })
  );

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
      'Warehouse', 'Bin', 'Audit Date', 'Expected', 'Matched', 'Variance',
      'Remaining', 'Total Scanned', 'Original Status', 'Final Status',
      'Re-audit Variance', 'Re-audit By', 'Auditor', 'Correction Remark',
    ];

    const csvRows = [
      headers.join(','),
      ...data.map(r =>
        [
          r.warehouse, r.bin,
          r.sessionDate ? new Date(r.sessionDate).toLocaleDateString('en-IN') : '',
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

// GET /api/reconciliation/export-detailed — device-level CSV export
router.get('/export-detailed', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status, date_from, date_to } = req.query;

    // Get summary first to apply same filters
    const summaryData = await buildReconciliation(warehouse, status, date_from, date_to);

    const headers = [
      'Warehouse', 'Bin', 'Audit Date', 'Bin Status',
      'Device Status', 'Serial No', 'Mac ID', 'Device ID',
      'Description', 'Type (No2)', 'Inventory Type',
      'Scan Type', 'Scanned At', 'Auditor',
    ];

    const csvRows = [headers.join(',')];

    for (const binRow of summaryData) {
      // Get inventory for this bin
      const inventoryRows = await prisma.inventory.findMany({
        where: { locationCode: binRow.warehouse, binCode: binRow.bin },
      });

      // Get sessions for date filter
      const sessionDateFilter = {};
      if (date_from) sessionDateFilter.gte = new Date(date_from);
      if (date_to) { const e = new Date(date_to); e.setHours(23,59,59,999); sessionDateFilter.lte = e; }

      const sessions = await prisma.auditSession.findMany({
        where: {
          warehouse: binRow.warehouse,
          ...(Object.keys(sessionDateFilter).length > 0 ? { startTime: sessionDateFilter } : {}),
        },
        select: { id: true, startTime: true, auditorEmail: true },
      });
      const sessionIds = sessions.map(s => s.id);
      const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

      const scans = sessionIds.length > 0
        ? await prisma.scannedDevice.findMany({
            where: { sessionId: { in: sessionIds }, binCode: binRow.bin },
          })
        : [];

      const matchedSerials = new Set(scans.filter(s => s.matched).map(s => (s.serialNo || '').toUpperCase()));

      // 1. Matched devices (scanned & found in inventory)
      for (const scan of scans.filter(s => s.matched)) {
        const sess = sessionMap[scan.sessionId];
        const inv = inventoryRows.find(r => r.serialNo && r.serialNo.toUpperCase() === (scan.serialNo || '').toUpperCase());
        csvRows.push([
          binRow.warehouse, binRow.bin,
          sess ? new Date(sess.startTime).toLocaleDateString('en-IN') : '',
          binRow.finalStatus,
          'Matched ✓',
          scan.serialNo || '', scan.macId || '', scan.deviceId || '',
          `"${inv?.description || ''}"`, inv?.no2 || '', inv?.inventory || '',
          scan.scanType || '', new Date(scan.scannedAt).toLocaleString('en-IN'),
          sess?.auditorEmail || '',
        ].join(','));
      }

      // 2. Missing devices (in inventory but NOT scanned)
      for (const inv of inventoryRows) {
        if (!inv.serialNo || matchedSerials.has(inv.serialNo.toUpperCase())) continue;
        csvRows.push([
          binRow.warehouse, binRow.bin, '', binRow.finalStatus,
          'Missing ✗',
          inv.serialNo || '', inv.macId || '', inv.deviceId || '',
          `"${inv.description || ''}"`, inv.no2 || '', inv.inventory || '',
          '', '', '',
        ].join(','));
      }

      // 3. Variance devices (scanned but NOT in inventory)
      for (const scan of scans.filter(s => !s.matched)) {
        const sess = sessionMap[scan.sessionId];
        csvRows.push([
          binRow.warehouse, binRow.bin,
          sess ? new Date(sess.startTime).toLocaleDateString('en-IN') : '',
          binRow.finalStatus,
          'Variance ⚠',
          scan.extractedSerial || '', '', '',
          '', '', '',
          scan.scanType || '', new Date(scan.scannedAt).toLocaleString('en-IN'),
          sess?.auditorEmail || '',
        ].join(','));
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation_detailed_${today}.csv"`);
    res.send(csvRows.join('\n'));
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
