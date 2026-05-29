# Warehouse Audit Tool — Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL database (local, AWS RDS, or Supabase)

---

## 1. Add required keys to `C:\credentials\.env`

```
WAREHOUSE_AUDIT_DB_URL=postgresql://USER:PASSWORD@HOST:5432/warehouse_audit
JWT_SECRET=your-random-secret-min-32-chars

# Email (choose one or leave blank to see OTP in backend console)
SENDGRID_API_KEY=SG.xxxxx
EMAIL_FROM=noreply@your-domain.com

# OR use SMTP:
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=you@gmail.com
# SMTP_PASS=app-password
```

**Supabase (free PostgreSQL):** Create project at supabase.com → Settings → Database → Copy Connection String.

---

## 2. Backend setup

```bash
cd backend
npm install
npx prisma generate
npx prisma db push          # Creates all tables
node seed.js                # Creates first admin user (piyush@wiom.in)
npm run dev                 # Starts on http://localhost:3001
```

---

## 3. Frontend setup

```bash
cd frontend
npm install
npm run dev                 # Starts on http://localhost:5173
```

---

## 4. Login

1. Open http://localhost:5173
2. Enter your admin email → OTP sent (or check backend console in dev)
3. Enter OTP → redirected to Admin Dashboard

---

## Workflow

### Admin
1. **Inventory** → Upload CSV/Excel with device data
2. **Assignments** → Assign bins to auditors
3. **Reconciliation** → View audit status, export CSV
4. **Corrections** → Flag resolutions, assign re-audits

### Auditor
1. Login → see assigned bins
2. Click a bin → scan devices (barcode/QR/manual keyboard entry)
3. Real-time matching: ✓ Matched / ⚠ Variance
4. End session when bin is complete

---

## QR Code Format (Wiom)

Format: `http://netbox.wiom.in/SERIAL/OTHER#`
Serial extracted from index[3] after splitting by `/`

Example: `http://netbox.wiom.in/SY104766/805034Y17#` → Serial = `SY104766`

---

## Production deployment

- **Backend**: Railway / AWS Elastic Beanstalk / EC2
  ```bash
  npm start
  ```
- **Frontend**: Vercel / AWS S3 + CloudFront
  ```bash
  npm run build     # outputs to dist/
  ```
- Set `FRONTEND_URL` in `C:\credentials\.env` to your deployed frontend URL

---

## Environment variables reference

| Key | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Random secret, min 32 chars |
| `SENDGRID_API_KEY` | Optional | Email OTPs via SendGrid |
| `EMAIL_FROM` | Optional | From address for OTP emails |
| `SMTP_HOST` | Optional | SMTP server for email |
| `SMTP_PORT` | Optional | SMTP port (default 587) |
| `SMTP_USER` | Optional | SMTP username |
| `SMTP_PASS` | Optional | SMTP password |
| `FRONTEND_URL` | Optional | CORS allowed origin (default: localhost:5173) |
| `PORT` | Optional | Backend port (default: 3001) |
