require('dotenv').config({ path: 'C:\\credentials\\.env' });

const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET not found in C:\\credentials\\.env. Please add it.');
  process.exit(1);
}
if (!process.env.WAREHOUSE_AUDIT_DB_URL) {
  console.error('ERROR: WAREHOUSE_AUDIT_DB_URL not found in C:\\credentials\\.env. Please add it.');
  process.exit(1);
}

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/reconciliation', require('./routes/reconciliation'));
app.use('/api/corrections', require('./routes/corrections'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
