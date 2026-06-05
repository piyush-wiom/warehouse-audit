# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Warehouse Audit Tool — a full-stack web app for managing physical device audits across warehouse bins. Auditors scan devices into bins; admins reconcile inventory vs. scan results.

**Live:** https://wiom-audit.vercel.app  
**Repo:** https://github.com/piyush-wiom/warehouse-audit  
Vercel auto-deploys on every push to `main`.

---

## Development Commands

### Backend (`/backend`)
```bash
npm run dev          # Start with nodemon (hot reload)
npm start            # Production start
npm run db:push      # Sync Prisma schema to DB (no migration file)
npm run db:generate  # Regenerate Prisma client after schema change
npm run db:migrate   # Create a named migration
npm run db:studio    # Open Prisma Studio GUI
```

### Frontend (`/frontend`)
```bash
npm run dev          # Vite dev server on :5173 (proxies /api → :3001)
npm run build        # Production build — run from inside /frontend dir
npm run preview      # Preview production build locally
```

> **Build gotcha**: Always run `npm run build` from inside the `frontend/` directory, not the repo root. The vite binary is a local dep.

### Deploy
```bash
git add <files>
git commit -m "..."
git push origin main   # triggers Vercel redeploy (~1–2 min)
```

---

## Environment Variables

All secrets are loaded from `C:\credentials\.env` (never the project directory).

**Required keys:**
- `WAREHOUSE_AUDIT_DB_URL` — PostgreSQL connection string
- `JWT_SECRET` — used to sign/verify JWTs
- `EMAIL_USER` / `EMAIL_PASS` — SMTP for OTP delivery (nodemailer)
- `FRONTEND_URL` — CORS allowed origin (defaults to `http://localhost:5173`)

Backend fails fast on startup if `JWT_SECRET` or `WAREHOUSE_AUDIT_DB_URL` is missing.

Frontend env: `VITE_API_URL` sets the API base URL (defaults to `/api` via Vite proxy in dev; on Vercel the backend is a separate service).

---

## Architecture

```
warehouse-audit/
├── backend/                 # Express.js + Prisma
│   ├── src/
│   │   ├── index.js         # App bootstrap, CORS, route mounting
│   │   ├── lib/prisma.js    # Prisma singleton
│   │   ├── middleware/auth.js
│   │   └── routes/
│   │       ├── auth.js          # OTP login flow
│   │       ├── users.js
│   │       ├── inventory.js     # Upload, bin/device queries
│   │       ├── assignments.js   # Admin assigns bins to auditors
│   │       ├── sessions.js      # Scan session lifecycle
│   │       ├── reconciliation.js # Bin-level status reports
│   │       └── corrections.js   # Admin corrections + re-audit
│   └── prisma/schema.prisma
└── frontend/                # React + Vite + Tailwind
    └── src/
        ├── App.jsx              # Route declarations
        ├── lib/api.js           # Axios instance (auto-injects JWT)
        ├── store/auth.js        # Zustand store (persisted to localStorage)
        ├── components/
        │   ├── Layout.jsx       # Sidebar nav (role-aware)
        │   └── ProtectedRoute.jsx
        └── pages/
            ├── admin/           # Dashboard, Users, Inventory, Assignments, Reconciliation, Corrections
            └── auditor/         # AuditorDashboard, ScanBin, ReauditBins
```

---

## Auth System

- **Login**: Email → OTP sent via SMTP → verify OTP → JWT issued
- **JWT payload**: `{ id, email, role }` — `role` is either `admin` or `auditor`
- **Middleware**:
  - `requireAuth` — validates JWT, attaches `req.user`
  - `requireAdmin` — calls `requireAuth` then checks `role === 'admin'`
- **Frontend**: JWT stored in Zustand (`persist` → localStorage under key `auth`). `api.js` auto-attaches `Authorization: Bearer <token>` to every request. 401 responses trigger automatic logout + redirect to `/login`.

---

## Data Model Key Points

| Model | Purpose |
|---|---|
| `Inventory` | One row per device (serial/MAC/deviceId). Full-refresh on every upload. |
| `InventoryUpload` | Metadata for each upload; current upload is always the latest. |
| `Assignment` | Admin assigns a `binCode` in a `warehouse` to an auditor email. |
| `AuditSession` | Created when auditor starts scanning a warehouse. `endTime` = locked/complete. |
| `ScannedDevice` | One row per scan. `matched=true` if serial found in Inventory. |
| `Correction` | Admin remark that overrides a bin's status to `Corrected`. |
| `ReauditAssignment` | Admin assigns a flagged bin back to an auditor for re-scan. |
| `OtpToken` | Short-lived OTP for login. |

---

## Core Business Logic

### Bin Status (`computeBinStatus`)

Status is **computed on the fly** — never stored. Two copies exist that must stay in sync:
- `backend/src/routes/sessions.js` — used during active scanning
- `backend/src/routes/reconciliation.js` — used for reports

Priority order (must be checked in this order):
```
Pending   → matched === 0 AND variance === 0
Complete  → matched === expected AND variance === 0
Excess    → matched > expected
Variance  → variance > 0
Scanning  → session not ended AND matched > 0 AND matched < expected
Short     → (fallthrough — session ended, matched < expected)
```

### Cross-Session Matching

A warehouse can have multiple audit sessions over time. The rules:
- **`matched`** = deduplicated by `serialNo` across **all** historical sessions (cumulative). A device matched once is always matched.
- **`variance`** = unmatched scans from **only the latest session that actually has scans for that specific bin** (`latestSessionForBin`). A clean re-audit resets variance to 0.
- **`sessionEnded`** = based on the latest session overall for the warehouse (not bin-specific).

`latestSessionForBin` is critical — it's **not** the latest warehouse session; it's found by scanning sessions in descending order and picking the first one that has `ScannedDevice` rows for that `binCode`.

This logic is duplicated in three places and must be kept identical:
1. `reconciliation.js` → `buildReconciliation()`
2. `assignments.js` → `GET /my-with-stats`
3. `corrections.js` → `GET /flagged`

### Scan Flow (`sessions.js POST /:id/scan`)

1. Block if session `endTime` is set (bin locked)
2. Block if `alreadyMatchedSerials.size >= expectedCount` (bin already complete)
3. Cross-ID duplicate check across all historical sessions (by extractedSerial, serialNo, macId, deviceId)
4. Try to match against inventory (by serialNo → macId → deviceId, MAC normalized)
5. If matched: save scan, **auto-lock session** (`endTime = now`) if this was the last expected device
6. If unmatched: save scan with `matched=false` (counts as variance)

### Scan Type Detection

- Input containing `http://netbox.wiom.in` → `QR` (serial extracted at index 3 of URL path)
- Everything else → `Barcode` (raw input used as-is)
- `Manual` type can be forced by the client

### Inventory Upload

`POST /api/inventory/upload` does a **full refresh** — deletes all existing `Inventory` and `InventoryUpload` rows, then re-inserts. After insert, it cascades orphan cleanup: any `Assignment`, `Correction`, or `ReauditAssignment` referencing a `warehouse::binCode` no longer in the new inventory is deleted.

---

## Frontend Patterns

- **`api.js`** is the single Axios instance — always import it, never use `fetch` or a second Axios instance.
- **`useAuthStore()`** from `store/auth.js` provides `{ user, token, setAuth, logout }`.
- **Toasts**: `react-hot-toast` — use `toast.success()`, `toast.error()`, `toast()` for warnings.
- **Icons**: `lucide-react` only.
- **Styling**: Tailwind utility classes. Custom badge classes defined in `index.css`: `badge-complete`, `badge-short`, `badge-excess`, `badge-variance`, `badge-pending`, `badge-scanning`, `badge-corrected`.
- Pages use `Promise.allSettled` for parallel data fetching so partial failures don't block the whole page.

---

## API Route Summary

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/auth/send-otp` | Public | Send OTP to email |
| `POST /api/auth/verify-otp` | Public | Verify OTP, return JWT |
| `GET /api/users` | Admin | List all users |
| `POST /api/inventory/upload` | Admin | Full inventory refresh (CSV/XLSX) |
| `GET /api/inventory/warehouses` | Auth | List warehouse codes |
| `GET /api/inventory/bins/:warehouse` | Auth | List bins with assignment status |
| `GET /api/assignments` | Admin | All assignments |
| `POST /api/assignments` | Admin | Assign bins (supports `bin_codes` array) |
| `DELETE /api/assignments/:id` | Admin | Unassign (Pending bins only, enforced in UI) |
| `GET /api/assignments/my-with-stats` | Auth | Auditor's bins with computed status (single optimized query) |
| `POST /api/sessions/start` | Auth | Start an audit session |
| `POST /api/sessions/:id/scan` | Auth | Submit a scan |
| `POST /api/sessions/:id/end` | Auth | Manually end a session |
| `GET /api/sessions/:id/bin-stats/:binCode` | Auth | Bin progress during active scan |
| `GET /api/reconciliation` | Admin | Bin-level report (filterable by warehouse/status/date) |
| `GET /api/reconciliation/export` | Admin | CSV export |
| `GET /api/reconciliation/export-detailed` | Admin | Device-level CSV export |
| `GET /api/reconciliation/daily-stats` | Admin | Per-day metrics |
| `GET /api/reconciliation/auditor-stats` | Admin | Per-auditor performance |
| `GET /api/reconciliation/bin-detail/:warehouse/:binCode` | Admin | Full drill-down (matched/missing/variance) |
| `GET /api/corrections/flagged` | Admin | Bins with Short/Excess/Variance |
| `POST /api/corrections` | Admin | Add correction remark |
| `POST /api/corrections/reaudit/assign` | Admin | Assign re-audit |
| `GET /api/corrections/reaudit/my` | Auth | Auditor's re-audit queue |
