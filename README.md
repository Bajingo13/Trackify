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
