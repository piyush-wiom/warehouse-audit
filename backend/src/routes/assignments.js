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

// GET /api/assignments/my  (auditor — their assigned bins)
router.get('/my', requireAuth, async (req, res) => {
  const assignments = await prisma.assignment.findMany({
    where: { assignedTo: req.user.email },
    orderBy: { createdAt: 'desc' },
  });
  res.json(assignments);
});

module.exports = router;
