const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/corrections/flagged  (bins with Short / Excess / Variance status)
router.get('/flagged', requireAdmin, async (req, res) => {
  try {
    const allBins = await prisma.inventory.groupBy({
      by: ['locationCode', 'binCode'],
      _count: { id: true },
    });

    const flagged = [];
    for (const { locationCode, binCode, _count } of allBins) {
      const expected = _count.id;
      const session = await prisma.auditSession.findFirst({
        where: { warehouse: locationCode },
        orderBy: { startTime: 'desc' },
      });
      if (!session || !session.endTime) continue;

      const scans = await prisma.scannedDevice.findMany({
        where: { sessionId: session.id, binCode },
      });
      const matched = scans.filter(s => s.matched).length;
      const variance = scans.filter(s => !s.matched).length;

      let status;
      if (matched === expected && variance === 0) continue; // Complete — not flagged
      if (matched > expected) status = 'Excess';
      else if (variance > 0) status = 'Variance';
      else status = 'Short';

      const correction = await prisma.correction.findFirst({
        where: { warehouse: locationCode, binCode },
        orderBy: { correctedAt: 'desc' },
      });

      flagged.push({
        warehouse: locationCode,
        bin: binCode,
        expected,
        matched,
        variance,
        status,
        auditor: session.auditorEmail,
        varianceSerials: scans.filter(s => !s.matched).map(s => s.extractedSerial),
        missingSerials: [], // populated from inventory
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
