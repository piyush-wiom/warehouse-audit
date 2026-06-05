const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/assignments  (admin — all assignments)
router.get('/', requireAdmin, async (req, res) => {
  const assignments = await prisma.assignment.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(assignments);
});

// POST /api/assignments — supports single OR bulk (bin_codes array)
router.post('/', requireAdmin, async (req, res) => {
  const { warehouse, bin_code, bin_codes, assigned_to } = req.body;

  // Normalize: support both single bin_code and array bin_codes
  const bins = bin_codes || (bin_code ? [bin_code] : []);
  if (!warehouse || bins.length === 0 || !assigned_to) {
    return res.status(400).json({ error: 'warehouse, bin_code(s), assigned_to required' });
  }

  const auditor = await prisma.user.findUnique({ where: { email: assigned_to } });
  if (!auditor || auditor.role !== 'auditor') {
    return res.status(400).json({ error: 'assigned_to must be an active auditor email' });
  }

  const upload = await prisma.inventoryUpload.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!upload) return res.status(400).json({ error: 'No inventory uploaded yet' });

  // Check which bins are already assigned — skip them
  const existingAssignments = await prisma.assignment.findMany({
    where: { warehouse, binCode: { in: bins } },
    select: { binCode: true },
  });
  const alreadyAssigned = new Set(existingAssignments.map(a => a.binCode));
  const toAssign = bins.filter(b => !alreadyAssigned.has(b));
  const skipped = bins.filter(b => alreadyAssigned.has(b));

  if (toAssign.length === 0) {
    return res.status(409).json({ error: 'All selected bins are already assigned', skipped });
  }

  const created = await Promise.all(
    toAssign.map(binCode =>
      prisma.assignment.create({
        data: { uploadId: upload.id, warehouse, binCode, assignedTo: assigned_to, assignedBy: req.user.email },
      })
    )
  );

  res.status(201).json({
    assigned: created,
    skipped,
    message: `Assigned ${created.length} bin(s)${skipped.length ? `, skipped ${skipped.length} already assigned` : ''}`,
  });
});

// DELETE /api/assignments/:id  (admin — remove a single assignment)
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  await prisma.assignment.delete({ where: { id } });
  res.json({ message: `Unassigned bin ${assignment.binCode} from ${assignment.assignedTo}` });
});

// GET /api/assignments/my  (auditor — their assigned bins)
router.get('/my', requireAuth, async (req, res) => {
  const assignments = await prisma.assignment.findMany({
    where: { assignedTo: req.user.email },
    orderBy: { createdAt: 'desc' },
  });
  res.json(assignments);
});

// GET /api/assignments/my-with-stats — assignments + bin status using same logic as reconciliation
router.get('/my-with-stats', requireAuth, async (req, res) => {
  try {
    const assignments = await prisma.assignment.findMany({
      where: { assignedTo: req.user.email },
      orderBy: { createdAt: 'desc' },
    });
    if (assignments.length === 0) return res.json([]);

    const warehouses = [...new Set(assignments.map(a => a.warehouse))];
    const binCodes  = [...new Set(assignments.map(a => a.binCode))];

    // Bulk fetch in parallel
    const [allSessions, inventoryGroups] = await Promise.all([
      prisma.auditSession.findMany({
        where: { warehouse: { in: warehouses } },
        orderBy: { startTime: 'desc' },
      }),
      prisma.inventory.groupBy({
        by: ['locationCode', 'binCode'],
        where: { locationCode: { in: warehouses }, binCode: { in: binCodes } },
        _count: { id: true },
      }),
    ]);

    const sessionIds = allSessions.map(s => s.id);
    const allScans = sessionIds.length > 0
      ? await prisma.scannedDevice.findMany({ where: { sessionId: { in: sessionIds } } })
      : [];

    // Index sessions by warehouse
    const sessionsByWH = {};
    for (const s of allSessions) {
      if (!sessionsByWH[s.warehouse]) sessionsByWH[s.warehouse] = [];
      sessionsByWH[s.warehouse].push(s);
    }

    // Index scans by sessionId::binCode
    const scansBySessionBin = {};
    for (const scan of allScans) {
      const key = `${scan.sessionId}::${scan.binCode}`;
      if (!scansBySessionBin[key]) scansBySessionBin[key] = [];
      scansBySessionBin[key].push(scan);
    }

    // Index expected counts
    const expectedMap = {};
    for (const g of inventoryGroups) {
      expectedMap[`${g.locationCode}::${g.binCode}`] = g._count.id;
    }

    const result = assignments.map(a => {
      const whSessions = sessionsByWH[a.warehouse] || [];
      // Latest session overall — used to determine if warehouse session ended
      const latestSessionOverall = whSessions[0] || null;

      // All scans for this bin across all sessions
      const allBinScans = whSessions.flatMap(s => scansBySessionBin[`${s.id}::${a.binCode}`] || []);

      // Matched = cross-session deduped
      const matchedSerials = new Set(
        allBinScans.filter(s => s.matched && s.serialNo).map(s => s.serialNo.toUpperCase())
      );
      const matched = matchedSerials.size;

      // Latest session that ACTUALLY has scans for this bin
      const latestSessionForBin = whSessions.find(s =>
        (scansBySessionBin[`${s.id}::${a.binCode}`] || []).length > 0
      ) || null;

      // Variance = only from that session (same as reconciliation)
      const latestBinScans = latestSessionForBin
        ? (scansBySessionBin[`${latestSessionForBin.id}::${a.binCode}`] || [])
        : [];
      const variance = latestBinScans.filter(s => !s.matched).length;

      const expected  = expectedMap[`${a.warehouse}::${a.binCode}`] || 0;
      const remaining = Math.max(0, expected - matched);
      const sessionEnded = latestSessionOverall ? !!latestSessionOverall.endTime : false;

      // Identical logic to reconciliation computeBinStatus
      let status;
      if (matched === 0 && variance === 0)              status = 'Pending';
      else if (matched === expected && variance === 0)  status = 'Complete';
      else if (matched > expected)                      status = 'Excess';
      else if (variance > 0)                            status = 'Variance';
      else if (!sessionEnded)                           status = 'Scanning';
      else                                              status = 'Short';

      return { ...a, stats: { expected, matched, variance, remaining, status, sessionEnded } };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
