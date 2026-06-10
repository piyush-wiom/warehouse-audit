const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/corrections/flagged  (bins with Short / Excess / Variance status)
router.get('/flagged', requireAdmin, async (req, res) => {
  try {
    const { warehouse, date_from, date_to } = req.query;

    // Build date filter — used ONLY to find which session to show as "auditor" (display only)
    // Scans from ALL sessions (not just the date range) are used for matched/variance calculation
    const sessionDateFilter = {};
    if (date_from) sessionDateFilter.gte = new Date(date_from);
    if (date_to) {
      const end = new Date(date_to);
      end.setHours(23, 59, 59, 999);
      sessionDateFilter.lte = end;
    }
    const hasDateFilter = Object.keys(sessionDateFilter).length > 0;

    // Fetch ALL sessions for the warehouse — no date filter on this query
    const allSessions = await prisma.auditSession.findMany({
      where: warehouse ? { warehouse } : {},
      orderBy: { startTime: 'desc' },
    });

    if (allSessions.length === 0) return res.json([]);

    // Fetch ALL scans in bulk for efficiency
    const allSessionIds = allSessions.map(s => s.id);
    const allScans = await prisma.scannedDevice.findMany({
      where: { sessionId: { in: allSessionIds } },
    });

    // Group scans by binCode
    const scansByBin = {};
    for (const scan of allScans) {
      const wh = allSessions.find(s => s.id === scan.sessionId)?.warehouse;
      if (!wh) continue;
      const key = `${wh}::${scan.binCode}`;
      if (!scansByBin[key]) scansByBin[key] = [];
      scansByBin[key].push({ ...scan, warehouse: wh });
    }

    // Build session lookup by warehouse
    const sessionsByWH = {};
    for (const s of allSessions) {
      if (!sessionsByWH[s.warehouse]) sessionsByWH[s.warehouse] = [];
      sessionsByWH[s.warehouse].push(s);
    }

    // Get current inventory bins from LATEST upload only
    const latestUpload = await prisma.inventoryUpload.findFirst({ orderBy: { createdAt: 'desc' } });
    const invWhere = {
      ...(latestUpload ? { uploadId: latestUpload.id } : {}),
      ...(warehouse ? { locationCode: warehouse } : {}),
    };
    const allBins = await prisma.inventory.groupBy({
      by: ['locationCode', 'binCode'],
      where: invWhere,
      _count: { id: true },
    });

    // Also get bins from historical scans not in current inventory
    const currentBinKeys = new Set(allBins.map(b => `${b.locationCode}::${b.binCode}`));
    const historicalBinKeys = new Set();
    for (const key of Object.keys(scansByBin)) {
      if (!currentBinKeys.has(key)) historicalBinKeys.add(key);
    }

    const binsToCheck = [
      ...allBins.map(b => ({ locationCode: b.locationCode, binCode: b.binCode, expected: b._count.id })),
      ...[...historicalBinKeys].map(key => {
        const [loc, bin] = key.split('::');
        return { locationCode: loc, binCode: bin, expected: null }; // historical: unknown expected
      }),
    ];

    const allCorrections = await prisma.correction.findMany({
      where: warehouse ? { warehouse } : {},
      orderBy: { correctedAt: 'desc' },
    });
    const correctionsByBin = {};
    for (const c of allCorrections) {
      correctionsByBin[`${c.warehouse}::${c.binCode}`] = c;
    }

    const lpnMap = {};
    const lpnRows = await prisma.inventory.findMany({
      where: invWhere,
      select: { locationCode: true, binCode: true, lpnBoxId: true },
      distinct: ['locationCode', 'binCode'],
    });
    for (const r of lpnRows) lpnMap[`${r.locationCode}::${r.binCode}`] = r.lpnBoxId || null;

    const flagged = [];

    for (const { locationCode, binCode, expected } of binsToCheck) {
      const binKey = `${locationCode}::${binCode}`;
      const scans = scansByBin[binKey] || [];
      if (scans.length === 0) continue;

      // Deduped matched count across ALL sessions (no date filter)
      const matchedSerials = new Set(
        scans.filter(s => s.matched && s.serialNo).map(s => s.serialNo.toUpperCase())
      );
      const matched = matchedSerials.size;
      const variance = scans.filter(s => !s.matched).length;

      // For historical bins (no longer in inventory), expected = matched (best we know)
      const effectiveExpected = expected !== null ? expected : matched;

      // Skip bins that are fully complete with no issues
      if (matched === effectiveExpected && variance === 0) continue;
      // Also skip Pending bins (no scans matched at all and no variance)
      if (matched === 0 && variance === 0) continue;

      let status;
      if (matched > effectiveExpected) status = 'Excess';
      else if (variance > 0) status = 'Variance';
      else status = 'Short';

      // Find the display auditor: latest ended session in date range (or any ended session)
      const whSessions = sessionsByWH[locationCode] || [];
      const sessionsInRange = hasDateFilter
        ? whSessions.filter(s => {
            const t = new Date(s.startTime);
            if (sessionDateFilter.gte && t < sessionDateFilter.gte) return false;
            if (sessionDateFilter.lte && t > sessionDateFilter.lte) return false;
            return true;
          })
        : whSessions;

      const latestEndedInRange = sessionsInRange.find(s => s.endTime);
      const latestEndedAny = whSessions.find(s => s.endTime);
      const displaySession = latestEndedInRange || latestEndedAny;

      // If there's a date filter but no ended session in range, skip unless it has historical data
      if (hasDateFilter && !latestEndedInRange) {
        // Still show if it has current audit issues (scanned recently)
        const scansInRange = scans.filter(s => {
          const t = new Date(s.scannedAt);
          if (sessionDateFilter.gte && t < sessionDateFilter.gte) return false;
          if (sessionDateFilter.lte && t > sessionDateFilter.lte) return false;
          return true;
        });
        if (scansInRange.length === 0) continue;
      }

      const correction = correctionsByBin[binKey] || null;

      flagged.push({
        warehouse: locationCode,
        bin: binCode,
        lpnBoxId: lpnMap[binKey] || null,
        expected: expected !== null ? expected : null,
        matched,
        variance,
        status,
        auditor: displaySession?.auditorEmail || null,
        varianceSerials: scans.filter(s => !s.matched).map(s => s.extractedSerial),
        missingSerials: [],
        correction: correction || null,
        isHistorical: expected === null,
      });
    }

    res.json(flagged);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/corrections
router.get('/', requireAdmin, async (req, res) => {
  const corrections = await prisma.correction.findMany({ orderBy: { correctedAt: 'desc' } });
  res.json(corrections);
});

// POST /api/corrections
router.post('/', requireAdmin, async (req, res) => {
  const { warehouse, bin_code, remark } = req.body;
  if (!warehouse || !bin_code || !remark) {
    return res.status(400).json({ error: 'warehouse, bin_code, remark required' });
  }
  const correction = await prisma.correction.create({
    data: { warehouse, binCode: bin_code, remark, correctedBy: req.user.email },
  });
  res.status(201).json(correction);
});

// POST /api/reaudit/assign
router.post('/reaudit/assign', requireAdmin, async (req, res) => {
  const { warehouse, bin_code, assigned_to } = req.body;
  if (!warehouse || !bin_code || !assigned_to) {
    return res.status(400).json({ error: 'warehouse, bin_code, assigned_to required' });
  }

  const auditor = await prisma.user.findUnique({ where: { email: assigned_to } });
  if (!auditor || auditor.role !== 'auditor') {
    return res.status(400).json({ error: 'assigned_to must be an active auditor' });
  }

  const ra = await prisma.reauditAssignment.create({
    data: { warehouse, binCode: bin_code, assignedTo: assigned_to, assignedBy: req.user.email },
  });
  res.status(201).json(ra);
});

// GET /api/reaudit/my  (auditor — their re-audit bins with variance details)
router.get('/reaudit/my', requireAuth, async (req, res) => {
  const assignments = await prisma.reauditAssignment.findMany({
    where: { assignedTo: req.user.email, completed: false },
    orderBy: { createdAt: 'desc' },
  });

  const enriched = await Promise.all(
    assignments.map(async a => {
      const session = await prisma.auditSession.findFirst({
        where: { warehouse: a.warehouse },
        orderBy: { startTime: 'desc' },
      });
      if (!session) return { ...a, varianceSerials: [], missingSerials: [] };

      const scans = await prisma.scannedDevice.findMany({
        where: { sessionId: session.id, binCode: a.binCode },
      });

      const inventoryRows = await prisma.inventory.findMany({
        where: { locationCode: a.warehouse, binCode: a.binCode },
      });

      const matchedSerials = new Set(scans.filter(s => s.matched).map(s => s.serialNo).filter(Boolean));
      const missingSerials = inventoryRows
        .filter(r => r.serialNo && !matchedSerials.has(r.serialNo))
        .map(r => r.serialNo);

      const varianceSerials = scans.filter(s => !s.matched).map(s => s.extractedSerial);

      return { ...a, varianceSerials, missingSerials };
    })
  );

  res.json(enriched);
});

module.exports = router;
