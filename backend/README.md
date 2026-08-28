# Trackify API

Node.js + Express + MySQL (`mysql2/promise`). ES modules.

## Layout

```
backend/
├── server.js                 bootstrap: load env, start HTTP listener
├── migrations/               *.sql, applied in filename order
├── scripts/
│   ├── migrate.js            migration runner (tracks state in schema_migrations)
│   └── seedAdmin.js          local dev admin seeder
└── src/
    ├── app.js                Express app assembly (middleware + routes + errors)
    ├── routes.js             top-level route table (mount points + auth guards)
    ├── config/
    │   ├── env.js            loads the repo-root .env (cwd-independent)
    │   └── db.js             connection pool + verifyConnection()
    ├── middleware/
    │   ├── authenticate.js       Bearer JWT  → req.user
    │   ├── operationalContext.js X-Company-Id / X-Branch-Id → req.context
    │   ├── requirePermission.js  RBAC check against role_permissions
    │   └── errorHandler.js
    ├── shared/
    │   ├── asyncHandler.js   wraps async route handlers
    │   └── audit.js          recordAudit(req, entry) → audit_logs
    └── modules/              one folder per feature area
        ├── auth/             login, register, me
        ├── admin/            companies, branches, users, roles, audit-logs
        ├── master-data/      customers (+ future: items, warehouses, …)
        ├── operations/       trips, dispatch, tracking, exceptions
        └── health/           GET /api/health
```

### Module convention

Each module folder contains:

- `<name>.controller.js` — request handlers, one exported function per action
- `<name>.routes.js` — an `express.Router()` wiring paths → `requirePermission` → controller
- `<name>.service.js` — reusable domain logic (optional)
- `<module>.routes.js` — aggregator that mounts the module's sub-routers

New modules are added by creating the folder and mounting its router in
`src/routes.js`.

## Route map

| Mount | Guards |
| --- | --- |
| `GET /api/health` | none |
| `/api/auth` | none |
| `/api/v1/admin` | `authenticate`, `operationalContext`, per-route `requirePermission` |
| `/api/v1/operations` | same |
| `/api/v1/master-data` | same |
| `/api/v1/customers` | legacy alias for `/api/v1/master-data/customers` |

## Response shape

`{ "success": true, "data": ... }` or `{ "success": false, "message": "..." }`.
List endpoints that paginate also return `{ "pagination": { page, limit, total, totalPages } }`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | `nodemon server.js` |
| `npm start` | `node server.js` |
| `npm run db:migrate` | apply pending migrations |
| `npm run db:seed-admin` | create/refresh the dev admin |
