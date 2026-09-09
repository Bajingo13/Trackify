# Trackify development log

| Title | Description | Remarks |
| --- | --- | --- |
| Railway deployment verification | Matched the local checkout and `Bajingo13/Trackify` `main` to commit `6ed759c`; checked Railway's GitHub deployment statuses and both public health endpoints. | Completed. Frontend and backend returned HTTP 200; MySQL reported connected. |
| Persistent upload safeguards | Added Railway-volume auto-detection, a write probe, storage readiness output, startup diagnostics, and path-safety tests for receipts and POD evidence. | Code complete. The Railway project shows `trackify-backend-volume` attached; writable/persistent status will be confirmed after deployment. |
| Continuous integration | Added a GitHub Actions release gate with MySQL 8.4, migrations, backend integration tests, and the frontend production build. | Code complete. It becomes active after the workflow is pushed to GitHub. |
| Frontend route code splitting | Converted application pages to lazy-loaded route chunks with a loading fallback. | Verified. Initial JavaScript fell from about 2.75 MB to 452 KB; heavy map and Excel code now loads on demand. |
| Production smoke test | Added a configurable command that checks frontend and backend health after a deployment. | Verified against the current Railway services; both returned HTTP 200. |
| Browser QA harness reliability | Added connection and command timeouts so the all-route crawl cannot silently exit without running checks. | Harness now correctly reports failure on this workstation: Chrome opens its debugging socket but does not answer CDP commands. Manual/UAT crawl remains pending. |
| Operations runbook | Documented Railway volume setup, readiness checks, backups, restore drills, monitoring, release verification, and UAT evidence. | Completed. Operational settings in Railway still require an authorized project owner. |

## Deferred product decisions

| Title | Description | Remarks |
| --- | --- | --- |
| Integrations | Decide which third-party services must be connected and define credentials, sync direction, failure handling, and audit requirements. | The current screen intentionally remains a placeholder until scope is approved. |
| Settings | Define company-level versus branch-level settings, defaults, permissions, and audit behavior. | The current screen intentionally remains a placeholder until scope is approved. |
| BIR/EIS handshake | Confirm the external filing provider/API and compliance workflow. | Current internal BIR/EIS records remain available; external submission depends on the client's system. |
