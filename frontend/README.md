# Trackify Frontend

React 19 + Vite + React Router + Tailwind (via `@tailwindcss/vite`). JavaScript / JSX.

## Layout

```
frontend/src/
├── main.jsx / App.jsx        entry + route table
├── context/                  AuthContext (JWT + company/branch in localStorage)
├── components/
│   ├── dashboard/            TopNav, KPI cards, dashboard widgets
│   ├── operations/           status badges, stat cards
│   └── shared/               Toast, ConfirmDialog, Pagination, crud.jsx
├── pages/                    one folder per feature area
│   ├── admin/                Companies, Branches, Users, Roles, AuditLogs
│   ├── master-data/          Customers
│   ├── operations/           Trips, Dispatch, LiveTracking, Exceptions
│   ├── fleet/  warehouse/    (still on in-memory mock services)
│   └── LoginPage, DashboardPage, ComingSoonPage
├── services/
│   ├── apiClient.js          fetch wrapper — base URL, Bearer + X-Company/Branch headers
│   ├── admin/ master-data/ operations/   real API services
│   └── fleet/ warehouse/     mock services (arrays) — to be migrated
└── styles/                   operations.css (shared ops-* class vocabulary)
```

### Page convention

Admin / master-data pages use the shared shell in
`components/shared/crud.jsx` (`PageShell`, `Modal`, `Field`, `TableCard`,
`StatusPill`) plus the `ops-*` classes from `styles/operations.css`, and talk to
the backend through a service in `services/<area>/`.

## Config

`VITE_API_URL` is read from the repo-root `.env` (Vite `envDir` points there).
Defaults to `http://localhost:5000`.

## Scripts

`npm run dev` (→ :8443), `npm run build` (→ repo-root `dist/`), `npm run preview`.
