# Trackify production runbook

## Railway services

- Frontend: `https://trackify-frontend-production-7e1f.up.railway.app`
- Backend: `https://trackify-backend-production-a447.up.railway.app`
- Frontend health: `GET /health`
- Backend readiness: `GET /api/health`

The backend readiness response checks MySQL and verifies that receipt/POD
storage is writable. On Railway it reports `503` when no persistent volume is
attached, preventing a deployment from appearing healthy while evidence files
would be written to an ephemeral filesystem.

## Backend volume

The production project already shows `trackify-backend-volume` attached to the
`trackify-backend` service. Do not create a second volume. For a new environment
or if the existing volume is ever replaced:

1. Attach one Railway Volume to the `trackify-backend` service.
2. Use an absolute mount path such as `/data/uploads`.
3. Railway supplies the actual mount path through
   `RAILWAY_VOLUME_MOUNT_PATH` automatically. Do not add
   `UPLOAD_ROOT` unless an explicit override is needed.
4. Set the backend healthcheck path to `/api/health`.
5. Deploy and confirm the response includes `"storage":"persistent"`.
6. Upload and retrieve one disposable receipt, redeploy the backend, then
   retrieve it again. This proves persistence instead of merely proving that
   the directory is writable.

Only one backend replica should write to a directly attached volume. Move the
storage adapter to object storage before horizontally scaling the backend.

## Release gate

Run locally before merging:

```bash
npm run check
```

GitHub Actions repeats this gate for pull requests and pushes to `main`.

After deployment, run:

```powershell
$env:TRACKIFY_FRONTEND_URL="https://trackify-frontend-production-7e1f.up.railway.app"
$env:TRACKIFY_BACKEND_URL="https://trackify-backend-production-a447.up.railway.app"
npm run smoke:production
```

The backend health payload includes the short Railway Git SHA so the running
revision can be compared with `git rev-parse --short HEAD`.

## Backup and recovery checklist

- Enable scheduled backups for both the MySQL volume and the uploads volume.
- Keep a periodic off-platform logical MySQL dump for project-level disaster
  recovery.
- Lock or retain a backup before schema migrations or destructive data work.
- Perform a restore drill in a non-production environment and record the date,
  restored backup, result, and operator.
- Periodically download an uploads-volume backup and confirm a sample receipt
  and POD photo can be opened.

A backup is not considered verified until a restore drill succeeds.

## Monitoring

Monitor both health URLs at five-minute intervals. Alert on non-2xx responses,
database degradation, storage degradation, or repeated response times above
five seconds. Railway deployment logs should be checked for the startup lines
`Database connection: OK` and `Evidence storage: OK (persistent)`.

## User acceptance testing

Use `docs/Trackify_System_Guide_QA_Playbook.html` against the production-like
environment. Complete every role-based flow and log each finding with:

- role and user
- page/workflow
- expected and actual result
- severity
- screenshot or error text
- retest result and deployed commit

Do not use real customer, financial, or driver data during the first pass.
