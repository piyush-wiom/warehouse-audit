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

async function buildReconciliation(warehouseFilter, statusFilter) {
  const inventoryWhere = warehouseFilter ? { locationCode: warehouseFilter } : {};

  const allBins = await prisma.inventory.groupBy({
    by: ['locationCode', 'binCode'],
    where: inventoryWhere,
    _count: { id: true },
  });

  const rows = await Promise.all(
    allBins.map(async ({ locationCode, binCode, _count }) => {
      const expected = _count.id;

      // Get the latest session for this warehouse+bin
      const latestSession = await prisma.auditSession.findFirst({
        where: { warehouse: locationCode },
        orderBy: { startTime: 'desc' },
      });

      const corrections = await prisma.correction.findMany({
        where: { warehouse: locationCode, binCode },
        orderBy: { correctedAt: 'desc' },
        take: 1,
      });

      if (!latestSession) {
        return {
          warehouse: locationCode,
          bin: binCode,
          expected,
          matched: 0,
          variance: 0,
          totalScanned: 0,
          remaining: expected,
          originalStatus: 'Pending',
          finalStatus: 'Pending',
          reauditVariance: null,
          reauditBy: null,
          auditor: null,
          correction: corrections[0] || null,
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
        warehouse: locationCode,
        bin: binCode,
        expected,
        matched,
        variance,
        totalScanned,
        remaining,
        originalStatus: status,
        finalStatus: corrections[0] ? 'Corrected' : status,
        reauditVariance: latestSession.isReaudit ? variance : null,
        reauditBy: latestSession.isReaudit ? latestSession.auditorEmail : null,
        auditor: latestSession.auditorEmail,
        correction: corrections[0] || null,
      };
    })
  );

  if (statusFilter) {
    return rows.filter(r => r.finalStatus === statusFilter || r.originalStatus === statusFilter);
  }
  return rows;
}

// GET /api/reconciliation
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status } = req.query;
    const data = await buildReconciliation(warehouse, status);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reconciliation/export
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { warehouse, status } = req.query;
    const data = await buildReconciliation(warehouse, status);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `reconciliation_${today}.csv`;

    const headers = [
      'Warehouse', 'Bin', 'Zone', 'Expected', 'Matched', 'Variance',
      'Remaining', 'Total Scanned', 'Original Status', 'Final Status',
      'Re-audit Variance', 'Re-audit By', 'Auditor', 'Correction Remark',
    ];

    const csvRows = [
      headers.join(','),
      ...data.map(r =>
        [
          r.warehouse, r.bin, '', r.expected, r.matched, r.variance,
          r.remaining, r.totalScanned, r.originalStatus, r.finalStatus,
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

module.exports = router;
