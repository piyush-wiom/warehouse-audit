const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const { Readable } = require('stream');
const prisma = require('../lib/prisma');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const REQUIRED_COLUMNS = ['LocationCode', 'ItemNo', 'No2', 'Description', 'Inventory', 'BinCode', 'ZoneCode', 'SerialNo', 'MacId', 'DeviceId'];

function normalizeRow(row) {
  // Normalize column names — case-insensitive key matching
  const out = {};
  for (const key of Object.keys(row)) {
    const match = REQUIRED_COLUMNS.find(c => c.toLowerCase() === key.toLowerCase());
    if (match) out[match] = String(row[key] || '').trim();
  }
  return out;
}

async function parseFile(buffer, mimetype, originalname) {
  const ext = originalname.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    return new Promise((resolve, reject) => {
      const rows = [];
      const stream = Readable.from(buffer.toString('utf8'));
      stream
        .pipe(csv())
        .on('data', row => rows.push(normalizeRow(row)))
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  } else {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    return raw.map(normalizeRow);
  }
}

// POST /api/inventory/upload
router.post('/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      return res.status(400).json({ error: 'Only CSV and Excel files are accepted' });
    }

    const rows = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (rows.length === 0) return res.status(400).json({ error: 'File is empty' });

    // Validate headers
    const firstRow = rows[0];
    const missing = REQUIRED_COLUMNS.filter(c => !(c in firstRow));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
    }

    // Full refresh — delete old inventory
    await prisma.inventory.deleteMany({});
    await prisma.inventoryUpload.deleteMany({});

    const uploadRecord = await prisma.inventoryUpload.create({
      data: { filename: req.file.originalname, uploadedBy: req.user.email },
    });

    // Detect duplicate SerialNo within same BinCode
    const warnings = [];
    const seen = new Map(); // key: binCode+serialNo
    const toInsert = [];

    for (const row of rows) {
      const key = `${row.BinCode}::${row.SerialNo}`;
      if (row.SerialNo && seen.has(key)) {
        warnings.push(`Duplicate SerialNo ${row.SerialNo} in BinCode ${row.BinCode}`);
      } else {
        if (row.SerialNo) seen.set(key, true);
      }

      toInsert.push({
        uploadId: uploadRecord.id,
        locationCode: row.LocationCode,
        itemNo: row.ItemNo || null,
        no2: row.No2 || null,
        description: row.Description || null,
        inventory: row.Inventory || null,
        binCode: row.BinCode,
        zoneCode: row.ZoneCode || null,
        serialNo: row.SerialNo || null,
        macId: row.MacId || null,
        deviceId: row.DeviceId || null,
      });
    }

    await prisma.inventory.createMany({ data: toInsert });

    res.json({
      message: `Uploaded ${toInsert.length} devices`,
      uploadId: uploadRecord.id,
      warnings: warnings.slice(0, 20),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// GET /api/inventory/warehouses
router.get('/warehouses', requireAuth, async (req, res) => {
  const rows = await prisma.inventory.findMany({
    select: { locationCode: true },
    distinct: ['locationCode'],
  });
  res.json(rows.map(r => r.locationCode));
});

// GET /api/inventory/bins/:warehouse
router.get('/bins/:warehouse', requireAuth, async (req, res) => {
  const rows = await prisma.inventory.findMany({
    where: { locationCode: req.params.warehouse },
    select: { binCode: true, zoneCode: true, inventory: true },
    distinct: ['binCode'],
    orderBy: { binCode: 'asc' },
  });

  // Enrich with assignment info
  const assignments = await prisma.assignment.findMany({
    where: { warehouse: req.params.warehouse },
    select: { binCode: true, assignedTo: true },
  });
  const assignedMap = {};
  for (const a of assignments) assignedMap[a.binCode] = a.assignedTo;

  const enriched = rows.map(r => ({
    ...r,
    isAssigned: !!assignedMap[r.binCode],
    assignedTo: assignedMap[r.binCode] || null,
  }));

  res.json(enriched);
});

// GET /api/inventory/devices/:warehouse/:bin
router.get('/devices/:warehouse/:bin', requireAuth, async (req, res) => {
  const devices = await prisma.inventory.findMany({
    where: { locationCode: req.params.warehouse, binCode: req.params.bin },
    orderBy: { serialNo: 'asc' },
  });
  res.json(devices);
});

// GET /api/inventory/uploads — all upload records for date filter
router.get('/uploads', requireAdmin, async (req, res) => {
  const uploads = await prisma.inventoryUpload.findMany({
    orderBy: { createdAt: 'desc' },
  });
  // Add device count per upload
  const enriched = await Promise.all(uploads.map(async u => {
    const count = await prisma.inventory.count({ where: { uploadId: u.id } });
    return { ...u, totalDevices: count };
  }));
  res.json(enriched);
});

// GET /api/inventory/upload-info — latest upload metadata
router.get('/upload-info', requireAdmin, async (req, res) => {
  const upload = await prisma.inventoryUpload.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!upload) return res.json(null);
  const count = await prisma.inventory.count();
  res.json({ ...upload, totalDevices: count });
});

// GET /api/inventory/devices-view — paginated device viewer for admin
router.get('/devices-view', requireAdmin, async (req, res) => {
  const { warehouse, bin, search, upload_id } = req.query;
  if (!warehouse) return res.status(400).json({ error: 'warehouse required' });

  const where = { locationCode: warehouse };
  if (bin) where.binCode = bin;
  if (upload_id) where.uploadId = upload_id;
  if (search) {
    where.OR = [
      { serialNo: { contains: search, mode: 'insensitive' } },
      { macId: { contains: search, mode: 'insensitive' } },
      { deviceId: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { no2: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, devices] = await Promise.all([
    prisma.inventory.count({ where }),
    prisma.inventory.findMany({
      where,
      orderBy: [{ binCode: 'asc' }, { serialNo: 'asc' }],
      take: 500, // max 500 per view — use bin filter for more
    }),
  ]);

  res.json({ total, devices });
});

module.exports = router;
