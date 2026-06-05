const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/corrections/flagged  (bins with Short / Excess / Variance status)
router.get('/flagged', requireAdmin, async (req, res) => {
  try {
    const { warehouse, date_from, date_to } = req.query;

    const allBins = await prisma.inventory.groupBy({
      by: ['locationCode', 'binCode'],
      where: warehouse ? { locationCode: warehouse } : {},
      _count: { id: true },
    });

    // Build session date filter
    const sessionDateFilter = {};
    if (date_from) sessionDateFilter.gte = new Date(date_from);
    if (date_to) {
      const end = new Date(date_to);
      end.setHours(23, 59, 59, 999);
      sessionDateFilter.lte = end;
    }

    const flagged = [];
    for (const { locationCode, binCode, _count } of allBins) {
      const expected = _count.id;
      const sessionWhere = {
        warehouse: locationCode,
        ...(Object.keys(sessionDateFilter).length > 0 ? { startTime: sessionDateFilter } : {}),
      };
      const sessions = await prisma.auditSession.findMany({
        where: sessionWhere,
        orderBy: { startTime: 'desc' },
      });
      // Need at least one ended session in range
      const latestEnded = sessions.find(s => s.endTime);
      if (!latestEnded) continue;

      // Cross-session scans for this bin
      const allSessionIds = sessions.map(s => s.id);
      const scans = await prisma.scannedDevice.findMany({
        where: { sessionId: { in: allSessionIds }, binCode },
      });

      // Deduped matched count across all sessions
      const matchedSerials = new Set(
        scans.filter(s => s.matched && s.serialNo).map(s => s.serialNo.toUpperCase())
      );
      const matched = matchedSerials.size;
      const variance = scans.filter(s => !s.matched).length;

      // Skip bins that are fully complete (scanned qty == expected qty, no variance)
      if (matched === expected && variance === 0) continue;

      let status;
      if (matched > expected) status = 'Excess';
      else if (variance > 0) status = 'Variance';
      else status = 'Short';

      const correction = await prisma.correction.findFirst({
        where: { warehouse: locationCode, binCode },
        orderBy: { correctedAt: 'desc' },
      });

      const lpnBoxId = scans.length > 0
        ? (await prisma.inventory.findFirst({ where: { locationCode, binCode }, select: { lpnBoxId: true } }))?.lpnBoxId || null
        : null;

      flagged.push({
        warehouse: locationCode,
        bin: binCode,
        lpnBoxId,
        expected,
        matched,
        variance,
        status,
        auditor: latestEnded.auditorEmail,
        varianceSerials: scans.filter(s => !s.matched).map(s => s.extractedSerial),
        missingSerials: [],
        correction: correction || null,
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
