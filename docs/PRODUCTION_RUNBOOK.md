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

## Backups

```bash
npm run db:backup                      # writes ./backups/trackify-<timestamp>.sql
npm run db:backup -- --out D:/backups  # or somewhere of your choosing
```

A logical dump of schema and data, taken with `--single-transaction` so a
driver filing an expense mid-backup neither blocks it nor corrupts it. DEFINER
clauses are stripped on the way out: a dump carrying the dumping account fails
to restore onto a fresh server where that account does not exist, which is
exactly the server you would be restoring onto in a real disaster.

On Windows, mysqldump ships with MySQL Server but is not added to PATH. The
script checks the usual install locations and otherwise asks for
`MYSQLDUMP_PATH`.

Keep a copy somewhere that is neither this machine nor Railway. A
provider-level backup is no help if what you lose is the provider account.

**Not yet done:** the restore drill below. Producing a dump has been verified;
restoring one has not, because the application database user cannot create a
database to restore into. That needs a MySQL account with CREATE privileges.

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

`.github/workflows/uptime.yml` probes both health URLs every 15 minutes and
fails the run — visibly in the Actions tab, and by email to whoever watches the
repository — on anything but a healthy answer.

It checks three things rather than one: that the service responds at all, that
it still reports `"database":"connected"`, and that it still reports
`"storage":"persistent"`. The last matters most. An app whose volume has gone
ephemeral is still up and still accepting receipt photos, and quietly losing
every one of them at the next deploy — a 200 alone would never show it.

Two honest limits. GitHub schedules are best-effort: runs are delayed under
load, and disabled entirely on a repository idle for 60 days. And the interval
is 15 minutes rather than the 5 asked for below, because GitHub routinely skips
anything shorter, and a schedule that lies about how often it ran is worse than
a slower one that does not. Treat this as a safety net; a pager is a paid
service.

### Original guidance

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
