const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/assignments  (admin — all assignments)
router.get('/', requireAdmin, async (req, res) => {
  const assignments = await prisma.assignment.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(assignments);
});

// POST /api/assignments
router.post('/', requireAdmin, async (req, res) => {
  const { warehouse, bin_code, assigned_to } = req.body;
  if (!warehouse || !bin_code || !assigned_to) {
    return res.status(400).json({ error: 'warehouse, bin_code, assigned_to required' });
  }

  const auditor = await prisma.user.findUnique({ where: { email: assigned_to } });
  if (!auditor || auditor.role !== 'auditor') {
    return res.status(400).json({ error: 'assigned_to must be an active auditor email' });
  }

  // Get latest upload
  const upload = await prisma.inventoryUpload.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!upload) return res.status(400).json({ error: 'No inventory uploaded yet' });

  const assignment = await prisma.assignment.create({
    data: {
      uploadId: upload.id,
      warehouse,
      binCode: bin_code,
      assignedTo: assigned_to,
      assignedBy: req.user.email,
    },
  });
  res.status(201).json(assignment);
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
