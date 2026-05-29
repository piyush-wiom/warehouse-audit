const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const SCAN_CONFIG = {
  urlPattern: 'http://netbox.wiom.in',
  serialIndex: 3,
};

function detectScanType(rawInput) {
  if (rawInput.includes(SCAN_CONFIG.urlPattern)) return 'QR';
  return 'Barcode';
}

function extractSerial(rawInput, scanType) {
  if (scanType === 'QR') {
    const parts = rawInput.split('/');
    return (parts[SCAN_CONFIG.serialIndex] || '').replace(/#.*$/, '').trim();
  }
  return rawInput.trim();
}

function normalizeMAC(val) {
  return (val || '').replace(/:/g, '').replace(/-/g, '').toUpperCase();
}

function matchAgainstInventory(extractedSerial, inventoryRows) {
  const normInput = normalizeMAC(extractedSerial);

  for (const row of inventoryRows) {
    if (row.serialNo && row.serialNo.toUpperCase() === extractedSerial.toUpperCase()) {
      return { row, matchField: 'serialNo' };
    }
    if (row.macId && normalizeMAC(row.macId) === normInput) {
      return { row, matchField: 'macId' };
    }
    if (row.deviceId && row.deviceId.toUpperCase() === extractedSerial.toUpperCase()) {
      return { row, matchField: 'deviceId' };
    }
  }
  return null;
}

function computeBinStats(inventoryRows, scans) {
  const expected = inventoryRows.length;
  const matched = scans.filter(s => s.matched).length;
  const variance = scans.filter(s => !s.matched).length;
  const remaining = Math.max(0, expected - matched);
  const totalScanned = matched + variance;
  return { expected, matched, variance, remaining, totalScanned };
}

function computeBinStatus(stats, sessionEnded) {
  if (!sessionEnded && stats.totalScanned === 0) return 'Pending';
  if (!sessionEnded) return 'Scanning';
  if (stats.matched === stats.expected && stats.variance === 0) return 'Complete';
  if (stats.matched > stats.expected) return 'Excess';
  if (stats.variance > 0) return 'Variance';
  return 'Short';
}

// POST /api/sessions/start
router.post('/start', requireAuth, async (req, res) => {
  const { warehouse, is_reaudit = false } = req.body;
  if (!warehouse) return res.status(400).json({ error: 'warehouse required' });

  const session = await prisma.auditSession.create({
    data: { auditorEmail: req.user.email, warehouse, isReaudit: is_reaudit },
  });
  res.status(201).json({ session });
});

// POST /api/sessions/:id/scan
router.post('/:id/scan', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { bin_code, raw_input, scan_type: manualType } = req.body;
    if (!bin_code || !raw_input) return res.status(400).json({ error: 'bin_code and raw_input required' });

    const session = await prisma.auditSession.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.endTime) return res.status(400).json({ error: 'Session already ended' });

    const scanType = manualType === 'Manual' ? 'Manual' : detectScanType(raw_input);
    const extractedSerial = extractSerial(raw_input, scanType);

    const inventoryRows = await prisma.inventory.findMany({
      where: { locationCode: session.warehouse, binCode: bin_code },
    });

    // Get all successful scans in this session for this bin
    const priorMatchedScans = await prisma.scannedDevice.findMany({
      where: { sessionId: id, binCode: bin_code, matched: true },
    });

    const normInput = normalizeMAC(extractedSerial);

    // Cross-ID duplicate detection
    for (const s of priorMatchedScans) {
      const fields = [s.extractedSerial, s.serialNo, s.macId, s.deviceId].filter(Boolean);
      if (fields.some(f => normalizeMAC(f) === normInput)) {
        return res.json({
          status: 'already_scanned',
          message: `Already Scanned — previously scanned as ${s.extractedSerial || s.id}`,
        });
      }
    }

    const match = matchAgainstInventory(extractedSerial, inventoryRows);

    if (match) {
      const { row } = match;
      // Check if this specific inventory row already matched
      const rowAlreadyMatched = priorMatchedScans.find(s =>
        normalizeMAC(s.serialNo || '') === normalizeMAC(row.serialNo || '') ||
        normalizeMAC(s.macId || '') === normalizeMAC(row.macId || '') ||
        normalizeMAC(s.deviceId || '') === normalizeMAC(row.deviceId || '')
      );
      if (rowAlreadyMatched) {
        return res.json({
          status: 'already_scanned',
          message: `Already Scanned — previously scanned as ${rowAlreadyMatched.extractedSerial}`,
        });
      }

      const scan = await prisma.scannedDevice.create({
        data: {
          sessionId: id,
          binCode: bin_code,
          warehouse: session.warehouse,
          rawInput: raw_input,
          extractedSerial,
          matched: true,
          deviceType: row.no2,
          serialNo: row.serialNo,
          macId: row.macId,
          deviceId: row.deviceId,
          scanType,
        },
      });

      return res.json({
        status: 'matched',
        message: `✓ Matched: ${extractedSerial} | ${row.no2 || ''} | ${row.description || ''} | ${scanType}`,
        scan,
        inventory: row,
      });
    }

    const scan = await prisma.scannedDevice.create({
      data: {
        sessionId: id,
        binCode: bin_code,
        warehouse: session.warehouse,
        rawInput: raw_input,
        extractedSerial,
        matched: false,
        scanType,
      },
    });

    res.json({
      status: 'variance',
      message: `⚠ ${extractedSerial} not found in this bin — counted as variance`,
      scan,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/end
router.post('/:id/end', requireAuth, async (req, res) => {
  const { id } = req.params;
  const session = await prisma.auditSession.update({
    where: { id },
    data: { endTime: new Date() },
    include: { scans: true },
  });

  // Build per-bin summary
  const bins = [...new Set(session.scans.map(s => s.binCode))];
  const summary = await Promise.all(
    bins.map(async binCode => {
      const inventoryRows = await prisma.inventory.findMany({
        where: { locationCode: session.warehouse, binCode },
      });
      const scans = session.scans.filter(s => s.binCode === binCode);
      const stats = computeBinStats(inventoryRows, scans);
      const status = computeBinStatus(stats, true);
      return { binCode, ...stats, status };
    })
  );

  res.json({ session, summary });
});

// GET /api/sessions  (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { warehouse } = req.query;
  const sessions = await prisma.auditSession.findMany({
    where: warehouse ? { warehouse } : undefined,
    include: { _count: { select: { scans: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(sessions);
});

// GET /api/sessions/my  (auditor)
router.get('/my', requireAuth, async (req, res) => {
  const sessions = await prisma.auditSession.findMany({
    where: { auditorEmail: req.user.email },
    include: { _count: { select: { scans: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(sessions);
});

// GET /api/sessions/:id
router.get('/:id', requireAuth, async (req, res) => {
  const session = await prisma.auditSession.findUnique({
    where: { id: req.params.id },
    include: { scans: { orderBy: { scannedAt: 'desc' } } },
  });
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

// GET /api/sessions/:id/bin-stats/:binCode
router.get('/:id/bin-stats/:binCode', requireAuth, async (req, res) => {
  const { id, binCode } = req.params;
  const session = await prisma.auditSession.findUnique({ where: { id } });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const [inventoryRows, scans] = await Promise.all([
    prisma.inventory.findMany({ where: { locationCode: session.warehouse, binCode } }),
    prisma.scannedDevice.findMany({ where: { sessionId: id, binCode }, orderBy: { scannedAt: 'desc' } }),
  ]);

  const stats = computeBinStats(inventoryRows, scans);
  const status = computeBinStatus(stats, !!session.endTime);
  res.json({ ...stats, status, scans });
});

module.exports = router;
