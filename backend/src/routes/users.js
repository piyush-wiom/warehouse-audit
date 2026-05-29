const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAdmin } = require('../middleware/auth');

// GET /api/users
router.get('/', requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(users);
});

// POST /api/users
router.post('/', requireAdmin, async (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role required' });
  if (!['admin', 'auditor'].includes(role)) return res.status(400).json({ error: 'role must be admin or auditor' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'User with this email already exists' });

  const user = await prisma.user.create({ data: { name, email, role } });
  res.status(201).json(user);
});

// DELETE /api/users/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ message: 'User deactivated' });
});

// PATCH /api/users/:id/role
router.patch('/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'auditor'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
  res.json(user);
});

module.exports = router;
