# PDC ERP — Industry-Standard Build (backend/ + frontend/)

This is the restructured version of the app: a real Express REST API in
`backend/`, and a Vite-built vanilla-JS single-page app in `frontend/`,
talking to each other over HTTP. Both personas — **Admin** and **Employee**
— are fully implemented and tested end-to-end (login, tasks, work timer,
daily reports, leave approval, payroll, HRMS, ATS, chat, notifications).

The original single-file prototype (`server.js` + `public/index.html` at
the repo root) is untouched and still works independently — this is a
separate, parallel implementation, not a replacement in place.

## Run it locally (two terminals)

**Terminal 1 — backend (API on port 4000):**
```
cd backend
npm install
cp .env.example .env
npm run dev
```

**Terminal 2 — frontend (dev server on port 5173, proxies /api and /uploads to :4000):**
```
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Default logins (same as before, change them before any real deployment):
- Admin: `admin` / `Pdc@2026`
- Employee: `sidhant` / `Sidhant@2026` (and nitin, zaki, saijal, ram, sandhya, priya — see backend/src/db/index.js for the full seed list)

The database is a local SQLite file at `backend/data/pdc_erp.sqlite`, created and seeded automatically on first run. Delete it to reset to the default seed data.

Since the initial build, the app has grown beyond the original feature set: self-registration and Google sign-in on the login screen, live presence/typing and group chat (Socket.IO), and an admin-managed Meetings module with optional email invites — see below.

## Meetings & email invites

Admins can schedule a meeting (Meetings page) with a title, time, duration and a join link (paste one from meet.google.com/new, Zoom, or Teams — the app doesn't call the Google Calendar API to mint links itself, since that needs Google Cloud OAuth credentials you'd have to set up). Everyone sees it on the Meetings page and as a "Next Meeting" card on their dashboard.

In-app notifications for a new/cancelled meeting always fire. Real emails are optional — set these in `backend/.env` to enable them (see `.env.example`):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@yourcompany.com
SMTP_PASS=<an app password, not your normal password>
SMTP_FROM=PDC ERP <no-reply@yourcompany.com>
```
Leave `SMTP_HOST` unset and emails are silently skipped (a one-time warning is logged) — nothing breaks. Email only reaches employees whose `email` field is actually filled in; the default seed users don't have one set, so add real addresses via HRMS or self-registration before relying on this.

## Employee onboarding (Admin → Onboarding)

Admins invite a new joiner; the joiner completes their own verification; the admin reviews and approves, which creates the employee account.

1. **Invite** — Onboarding → *+ New Joiner*. You get a personal link (`<FRONTEND_URL>/#/onboard/<token>`, valid 7 days) to copy or share on WhatsApp; it is also emailed if SMTP is configured and an email was entered. Set `FRONTEND_URL` in `backend/.env` to your real frontend URL in production, otherwise emailed links point at `localhost:5173`.
2. **Joiner (no login)** — opens the link: details → Aadhaar number + card photos → live selfie with an automatic face match against the card photo → reads and e-signs the NDA (typed name + drawn signature; time, IP and device are recorded with a SHA-256 fingerprint of the exact text they signed).
3. **Review** — the submission shows up under *Needs review* (and as a notification). The review screen shows the card, selfie, both face-match results and the signed NDA (printable / save as PDF). Approve creates the user with the next `EMPxxxx` code and a random one-time password shown once; *Send back* gives the joiner a new link plus your note; *Reject* kills the link.

Things worth knowing:
- **Face match is a guide, not proof.** It runs in the browser with `@vladmandic/face-api` (models in `frontend/public/models`, ~12 MB, fetched only on onboarding screens). It runs on the joiner's device *and* again on the admin's device at review time, so a tampered client can't fake it. Government-ID portraits are small and old, so a miss means "look closer", not "fraud". There is no blink/liveness check.
- **Aadhaar numbers are format-checked only** (12 digits + Verhoeff checksum). Nothing is verified with UIDAI — that needs an authorised AUA/KUA integration. Only the **last 4 digits** are stored.
- **ID images are private.** They are stored in `backend/private/onboarding/` (not under the public `/uploads`) and served only to Admins through an authenticated endpoint; every view is written to the audit log. After approval, *Delete ID images* removes the Aadhaar/selfie files but keeps the signed NDA. Collecting Aadhaar images and biometrics is regulated in India (DPDP Act); the joiner is shown a consent checkbox, but confirm your retention policy.
- **The NDA text is a generic starter**, editable under Onboarding → *NDA template* (placeholders `{{name}} {{company}} {{designation}} {{date}}`). Have a lawyer review it. Signed agreements keep the text the person actually saw.
- **Camera access needs HTTPS or localhost.** On a plain-`http://` LAN address the joiner is offered a phone-camera / file upload instead of the live camera.

## What's different from the original prototype

- **Real routing**: Express with one router file per domain (`backend/src/routes/*.routes.js`) instead of one long if/else chain.
- **Middleware-based auth**: `requireAuth` / `requireAdmin` as Express middleware (`backend/src/middleware/auth.js`).
- **Security additions**: `helmet` for HTTP security headers, `express-rate-limit` on `/api/login` (20 attempts / 15 min), and file-upload validation by MIME type + extension (the original only sanitized the filename).
- **CORS**: explicit, configurable via `CORS_ORIGIN` in `.env` — needed now that frontend and backend are separate origins in dev.
- **Frontend build step**: Vite + ES modules, split into `lib/` (api client, state, DOM helpers), `pages/` (one file per screen), `components/modals.js` (every form/modal), and `router.js` (navigation + the 5-second notification poll).
- **One bug fixed in the port**: the original attendance page wired up an `editAttendance(...)` handler that was never defined, so an Admin's attendance-status dropdown silently failed. It's implemented now (`frontend/src/pages/attendance.js`).

## Build for production

```
cd frontend && npm run build        # outputs static files to frontend/dist/
cd backend  && NODE_ENV=production npm start
```

Serve `frontend/dist/` as static files behind the same reverse proxy that
terminates TLS in front of the backend (see the Deployment Playbook in the
"PDC ERP — Technical Guide & Deployment Playbook" document for the full
nginx/Caddy + systemd/PM2 + backup setup). Point `CORS_ORIGIN` at the
production frontend URL, and set a real `PORT`/`HOST` for the API.

## Growth modules (sales, content, client reports)

Built for the agency's own workflow of pitching reels and content strategy to cafes and restaurants.

| Screen | What it does | Backend |
|---|---|---|
| **Leads** (Growth) | Drag-and-drop sales board: New, Contacted, Pitched, Proposal sent, Won, Lost. Follow-up dates, activity log, service packages, and one-click "Convert to client". A lost lead must have a reason. | `routes/leads.routes.js` |
| **Content** (Workspace) | Every reel from Idea to Posted, as a board or month calendar. Employees see only their own items. Only an admin or the client can mark content Approved. | `routes/content.routes.js` |
| **Client review link** | One private link per client (`#/review/<token>`, no login). The cafe owner watches drafts and taps Approve or Request changes; the team is notified. The link can be replaced, which kills the old one at once. Rate-limited, and the public API exposes no staff data. | same file, `/api/review/public/*` |
| **Client reports** (Growth) | One-page monthly report built from Social, Content and Task data, with plain-English highlights and the cafe's own results (offers redeemed, new customers). Print it and choose Save as PDF. | `routes/clientreport.routes.js` |

Automation: a daily reminder goes to the lead's owner when a follow-up is due or overdue (`jobs/automationSweep.js`, de-duplicated per lead per day).

Set `FRONTEND_URL` in `backend/.env` to the public site address, otherwise review links point at localhost.
