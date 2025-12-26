# QR Attendance on Cloudflare + OneDrive

A production-ready QR attendance workflow for a single class. Students scan a rotating QR code to check in/out from their phones. Data is stored in an Excel workbook on OneDrive via Microsoft Graph. Backend runs on Cloudflare Workers + KV (free tier); frontend is static (Vite) and deployable to Cloudflare Pages (free tier).

## Architecture Overview
- **Frontend**: `/web` (Vite, TypeScript). Deployed to **Cloudflare Pages**. Pages include student form (`/t/:token`), admin dashboard (`/admin`), and printable QR view (`/print/:token`).
- **Backend**: `/worker` (Cloudflare Worker, TypeScript). Endpoints handle admin session management, roster/config fetch, attendance recording, and daily summary generation. Session tokens stored in Workers KV with TTL.
- **Storage**: **OneDrive Excel workbook** (`Attendance.xlsx`) accessed via Microsoft Graph. Uses tables for roster, config, attendance log, and daily summary.
- **Security**: Admin endpoints require `X-Admin-Key`. Rate limiting on submissions. IPs are hashed with salt. Server-side timestamps in America/New_York. Tokenized QR prevents re-use.

## Workbook Schema (OneDrive Excel)
Create `Attendance.xlsx` in OneDrive root (or set `EXCEL_ITEM_ID`). Sheets with tables (create via setup endpoint):

- **Roster** (`tblRoster`)
  - `studentKey` (unique id), `displayName`, `active` (TRUE/FALSE). Teacher edits each term.
- **ClassConfig** (`tblConfig`)
  - `classStartTime` (HH:MM 24h), `classEndTime` (HH:MM), `timezone` (America/New_York), `tardyMinutesLate` (default 5), `earlyLeaveMinutes` (default 30).
- **AttendanceLog** (`tblAttendanceLog`)
  - `serverTimestampISO`, `classDate`, `studentKey`, `displayName`, `action`, `userAgent`, `ipHash`.
- **DailySummary** (`tblDailySummary`)
  - `classDate`, `studentKey`, `displayName`, `firstCheckInISO`, `lastCheckOutISO`, `computedStatus`, `overrideStatus`, `finalStatus`, `notes`.

`finalStatus` is set to `overrideStatus` when provided, otherwise `computedStatus`. Teacher can edit `overrideStatus` and `notes` freely.

## Key Endpoints (Worker)
- `POST /api/admin/start-session` (admin): Creates a rotating token for the class date (default today NY). Stores metadata in KV (TTL 36h) and returns session URL + expiry.
- `GET /api/session?token=...`: Validates token, returns roster + class config for the session date.
- `POST /api/attendance`: Records attendance with server-side timestamp, UA, and IP hash. Idempotent within 2 minutes for same student/action. Rate-limited per IP/minute.
- `POST /api/admin/close-session` (admin): Computes daily summary (Present/Tardy/Absent) and upserts `DailySummary` rows, preserving overrides.
- `POST /api/admin/setup-workbook` (admin): One-time creation of workbook tables if missing.

## Admin Rules & Status Logic
- Absent: no check-in on class date.
- Tardy: check-in after start + 5 minutes, or check-out before end - 30 minutes. (Defaults read from `ClassConfig`; configurable.)
- Present: otherwise. No automatic early-leave if no checkout exists.

## Hosting Choices
- Frontend: **Cloudflare Pages** (static). `npm run build` under `/web` outputs to `dist` for Pages.
- Backend: **Cloudflare Worker** deployed via `wrangler`. Workers KV stores session tokens and rate-limit buckets.

## Prerequisites
- Node.js 18+
- npm
- Cloudflare account with Workers + Pages (free tier)
- Microsoft 365 account with OneDrive and admin consent for Graph app

## Setup: Microsoft Graph App Registration
1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations** → **New registration**. Name it "QR Attendance Worker". Choose **Accounts in this organizational directory only**.
2. After creation, note **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets** → **New client secret**. Copy the secret value (store for Worker env `MS_CLIENT_SECRET`).
4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**. Add `Files.ReadWrite.All` (or `Sites.ReadWrite.All`).
5. Click **Grant admin consent** for the tenant. Ensure status shows "Granted".
6. Upload/create `Attendance.xlsx` in OneDrive root. You can also let the Worker create tables via `/api/admin/setup-workbook`. To use item ID, right-click the file in OneDrive → **Details** → copy the **Item ID**.

## Cloudflare Worker Setup
1. Install Wrangler: `npm i -g wrangler` (or use `npx wrangler`).
2. In `/worker`, copy `.dev.vars.example` to `.dev.vars` and set values:
   - `ADMIN_KEY` (strong password for admin endpoints)
   - `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
   - `EXCEL_ITEM_ID` (preferred) or `EXCEL_FILE_PATH` (e.g., `/Attendance.xlsx`)
   - `IP_HASH_SALT` (random string)
3. Create KV namespace in Cloudflare dashboard: **Workers** → **KV** → **Create** (name `qr-attendance`). Note the Namespace ID.
4. Update `wrangler.toml` binding `KV_SESSIONS` with the namespace ID.
5. Local dev: `cd worker && npm install && npm run dev` (uses `.dev.vars`).
6. Deploy: `npm run deploy` (wrangler publish). Ensure environment variables are set in Cloudflare Worker settings and KV binding attached.

## Cloudflare Pages (Frontend) Setup
1. `cd web && npm install`.
2. Local dev: `npm run dev`.
3. Build: `npm run build` outputs to `dist`.
4. Deploy on Cloudflare Pages: create a new Pages project connected to this repo or upload `dist`. Set **Environment variables**:
   - `VITE_API_BASE` (Worker URL, e.g., `https://your-worker.your-domain.workers.dev`)
5. For previews, Pages will rebuild automatically via CI.

## Daily Workflow (Teacher)
1. Visit `/admin` on the Pages site.
2. Enter the admin key (kept in memory only).
3. Click **Start Today’s Session**. A tokenized URL and QR appear.
4. Click **Print QR** to open `/print/:token` and print to letter-size.
5. Students scan QR, choose their name, choose Check-In/Out, and submit. They see a success screen with server time.
6. After class, click **Close Today’s Session** to compute the summary. Present/Tardy/Absent counts display.
7. In OneDrive `Attendance.xlsx`, teacher can edit **Roster** (each term), **ClassConfig**, and override statuses/notes in **DailySummary**.

## Local Smoke Test Checklist
- `npm run lint` in `/worker` and `/web` (after install).
- `npm run test` (frontend vitest) if desired.
- `npm run dev` in `/worker`, then submit a test attendance via `/web` dev server pointing to local worker.

## Deployment Commands
```bash
# worker
cd worker
npm install
npm run deploy

# web
cd web
npm install
npm run build
# Upload dist to Cloudflare Pages or connect repo
```

## Notes
- Timezone fixed to America/New_York on the server for classDate and status logic.
- QR token TTL is 36h; start a new session daily. Tokens stored in KV as `session:<token>`.
- Rate limiting per IP/minute on `/api/attendance` to reduce abuse.
- Never trusts client timestamps; server records ISO time.
- Phones only UI; minimal styles for fast loads.

