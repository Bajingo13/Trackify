# AstreaBlue Trackify

Trip Ticket Management System — React + Vite frontend, Node/Express + MySQL backend.

## Monorepo layout

```
ttms_system/
├── frontend/            React + Vite app (JavaScript / JSX)
├── backend/             Node.js + Express API (ES modules)
├── .env                 single local env file, read by BOTH apps (gitignored)
├── .env.example         template
└── package.json         thin orchestrator (runs both apps)
```

The frontend and backend are independent npm packages. The root `package.json`
only orchestrates them.

## Prerequisites

- Node 22+
- MySQL 8 running locally, with a database `trackify` and a user that has
  `ALL PRIVILEGES ON trackify.*`

## First-time setup

```bash
npm install                 # installs root + frontend + backend
cp .env.example .env         # then fill in DB_PASSWORD (and review the rest)
npm run db:migrate           # create / update all tables
npm run db:seed-admin        # create the local admin login
npm run dev                  # start both servers
```

- Frontend → http://localhost:8443
- Backend  → http://localhost:5000
- Health   → http://localhost:5000/api/health

Default local login (configurable in `.env`): `admin@astreablue.com` / `Trackify!Dev2026`

## Updating an existing install

After pulling new code on another machine or server:

```bash
npm install            # picks up new dependencies (root postinstall covers frontend + backend)
npm run db:migrate     # applies new tables (`npm start` also runs this on boot)
npm run push:setup     # once: turns on phone notifications for drivers
```

`push:setup` writes a notification key pair into `.env` and does nothing if one is already
there. Restart the API afterwards, and set `VAPID_SUBJECT` in `.env` to a real contact
(`mailto:you@company.com`) before going live. Never change the pair later: phones registered under
it would stop receiving notices until their drivers turn notifications off and on again.
Use `npm run push:setup -- --print` instead if your host takes environment variables, not a file.
Notifications need the site on HTTPS (localhost is fine for testing).

## Driver licences: scanning and expiry reminders

**Who can change a licence.** Only the office (`driver.manage`, in Driver Management). The Driver App
is view-only: drivers see their licence number, type, expiry, photo and expiry warnings, and there is
no route in the app to add, scan, replace or remove any of it. The app reads the same record the office
writes, so there is nothing to synchronise — a change made in the office shows on the driver's phone
the next time the app is opened or comes to the foreground (and at least once a minute while open).
The licence type defaults to Professional when none is recorded, in both places.

**Registration is a two-step, atomic workflow.** The first step asks only for the required Employee
Number and PIN and checks that the number is available. The second step collects the profile and a
clear licence image. OCR fills the licence fields, then an Admin compares the final values with the
image and explicitly confirms the review. OCR is a proposal: the Admin can correct a misread value.
The server independently checks that the image is readable and saves the credentials, profile and
photo in one operation, so a failure leaves no partial account or stray file. A PDF scan is converted
to an image of its first page in the browser before it is read and stored.

**Scanning (office).** On Driver Management, a photo of a licence is read and its number, name, type
and expiry are filled into the form for a person to check. It runs inside the API with Tesseract
(`tesseract.js` + `sharp`, English data bundled) — the photo is never sent to a third party and is
deleted as soon as it is read. It proposes, never decides: values from the photo are marked "Read
from the licence" or "Not sure", and replacing a driver's photo only offers the differences. JPG, PNG
and WebP are read; a PDF is converted in the browser. Registration and replacement require a readable
result, so `LICENSE_SCAN=off` pauses those workflows. Accuracy depends on the photo — a clear, flat,
well-lit picture of the whole card.

**Expiry.** A licence is "expiring" within 60 days and "expired" after its date (good *through* the
expiry date), counted on the Manila calendar — one rule shared by the driver list, Compliance, Reports,
dispatch, the Driver App and the reminders (`backend/src/shared/driverLicense.js`).

**Reminders.** Daily, at 60/30/14/7/1 days and once when expired, each driver gets a phone
notification and the people who manage drivers get one email listing what crossed a threshold. Each is
sent once. In production it runs by itself; in development it does not (demo managers have real-looking
addresses) unless `DRIVER_LICENSE_REMINDERS=on`. To see or send what is due, anywhere:

```bash
npm run driver-license:remind            # list what would be sent
npm run driver-license:remind -- --send  # send it
```

## Driver App: expense receipts

A driver files a claim one of two ways, and can switch between them at any point without losing what is
entered. **Scan receipt** (the default) takes or picks a photo, and the API reads it with the same
in-server Tesseract engine and queue as licences (`backend/src/shared/receiptScan/`). It fills in the
type of expense (fuel, toll, parking, meals, lodging, repair), the total paid (never cash tendered or
change), a description (merchant plus what was bought, e.g. "Petron — Turbo Diesel 35.200 L"), the date
and the OR/SI number. Every value stays editable and is tagged "From receipt", or "Check this" when it
was hard to read. **Type it in** is the plain form. Either way the photo is attached to the claim, and
finance reviews it as before. The scan stores nothing (`POST /api/v1/driver/receipts/scan`), needs
signal (offline, the driver types the claim and it queues as usual), and `RECEIPT_SCAN=off` turns
reading off without affecting manual claims.

## Running the apps separately

```bash
cd backend  && npm run dev   # API only  → :5000
cd frontend && npm run dev   # web only  → :8443
```

## Scripts (root)

| Script | Purpose |
| --- | --- |
| `npm run dev` | frontend + backend together (via `concurrently`) |
| `npm run check` | backend tests followed by the frontend production build |
| `npm run smoke:production` | verify configured production frontend/backend health URLs |
| `npm run build` | production build of the frontend → `dist/` |
| `npm run db:migrate` | apply `backend/migrations/*.sql` (idempotent) |
| `npm run db:seed-admin` | create/refresh the local admin account |
| `npm run push:setup` | one-time: make the key pair that turns on driver phone notifications |
| `npm run driver-license:remind` | list (or, with `-- --send`, send) driver licence expiry reminders now |

## Environment variables

See [.env.example](.env.example). One root `.env` serves both apps — the backend
loads it via `backend/src/config/env.js`; Vite reads it via `envDir`.

Never commit real secrets. `.env` is gitignored.

## Production

The frontend and backend deploy as separate Railway services. Receipt and
proof-of-delivery uploads require a persistent volume attached to the backend;
see [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) before deploying.

Pull requests and pushes to `main` run backend tests and a production frontend
build through GitHub Actions. Run the same release gate locally with
`npm run check`.
