# Trackify web release-readiness cases

This Playwright suite is a repeatable, non-destructive browser gate for the
staff web application. It runs against the installed Chrome channel and
intentionally uses one worker so shared seeded data and login throttling remain
predictable.

## Running the suite

Start Trackify's backend and web server, then point the suite at them with
`TRACKIFY_WEB_URL` and `TRACKIFY_API_URL`.

| Setup | Backend (`TRACKIFY_API_URL`) | Web (`TRACKIFY_WEB_URL`) |
| --- | --- | --- |
| Local development | `http://localhost:5000` (`npm run dev` in `backend`; `PORT` overrides) | the Vite dev server, `npm run dev` in `frontend` (default `5173` — **see the warning below**) |
| Production-style build | the same API | `http://localhost:8444` (the suite's fallback) serving a built `dist` |

```powershell
$env:TRACKIFY_WEB_URL = "http://localhost:5180"   # whichever port Trackify's web server is really on
$env:TRACKIFY_API_URL = "http://localhost:5000"
npm --prefix frontend run test:e2e:web
```

The fallbacks when the variables are unset are `http://localhost:8444` for the
web server and `http://localhost:5001` for the API. Neither is where a
default development setup puts them, so set both explicitly.

### The target check (it will refuse to run)

Other projects on a developer machine often hold the same ports — 5173 is the
usual collision for Vite — and this suite signs in with a seeded staff
account. Before any test starts, `e2e/global-setup.js` asks the servers what
they are and **refuses to run** unless:

- both URLs are on this machine (`localhost`, `127.0.0.1`, `::1`). To test a
  remote Trackify on purpose, set `TRACKIFY_E2E_ALLOW_REMOTE=yes`;
- the web page's <title> contains "Trackify";
- `GET /api/health` on the API reports `"service": "trackify-api"`, and the same
  holds for the API the web server itself reaches (a dev server proxies `/api`
  onward to whatever is on its configured port).

When it refuses, it names what it found ("page title is 'Bloom&Borrow'"), starts
no test, and sends no credentials. The check lives in `e2e/helpers/target.js`
and has unit tests in `src/test/e2eTarget.test.js`.

If the Vite dev server picks another port because 5173 is taken, pass it
explicitly (`npx vite --port 5180 --strictPort`) and set `TRACKIFY_WEB_URL` to match.

The documented local demo staff account is the fallback. For any other seeded
environment, set `TRACKIFY_TEST_EMAIL` and `TRACKIFY_TEST_PASSWORD`. The suite
does not print either credential. Use `npm --prefix frontend run
test:e2e:web:list` to review coverage without contacting the app.

Authenticated Playwright traces are off by default because they can retain
bearer-token request headers. For local debugging with a disposable account,
set `TRACKIFY_E2E_TRACE=1`; artifacts stay under the operating system's temp
directory rather than the repository.

## Requirements and limitations

- **A seeded staff account and at least the demo data.** One search case
  (`a real ticket number typed into the palette is found`) and the CSV export case
  skip themselves when the database has no trips.
- **`offline-shell.spec.js` needs a production build.** The staff service worker
  is not registered under the Vite dev server, so its first case skips there.
  Serve the build with Trackify's own static server (`frontend/server.js`). In
  production the API is a separate service, so the build has to know where it is:

  ```powershell
  cd frontend
  $env:VITE_API_URL = "http://localhost:5000"
  npm run build                       # a local build writes the repo-root dist/ (gitignored)
  $env:PORT = "8450"; node server.js  # leave running in this window
  ```

  then, in another window, run the suite with `TRACKIFY_WEB_URL=http://localhost:8450`.
  **The build replaces whatever is in the repo-root `dist/`** (a local build writes
  there; only a Railway build writes `frontend/dist`), so use the `.env` you normally
  build with, or keep a copy of the old one. The target check accepts this split
  layout: a web server with no `/api` of its own is fine, and only a *different*
  service answering there is refused.
- **Role cases change what the console shows, not what the server allows.**
  `helpers/roles.js` replaces the permissions the session reports so the console
  renders as another role. What the server refuses regardless is asserted
  separately — against the real endpoints in `search-restricted.spec.js`, and in
  the backend tests.
- **Vehicle photos and profile photos.** Uploaded files live in a gitignored
  folder. A database that outlives its files (another machine, a wiped volume)
  is handled — the app falls back to the bundled photographs — and the smoke
  routes must stay free of 4xx responses either way.
- The staff login throttle is shared. The login cases stub the sign-in response so
  they cannot consume it.

## Coverage map

| Area | Cases | Release signal |
| --- | --- | --- |
| Staff login and recovery | Email/password fields render; password show/hide works; Remember Me persistence is exercised with a stubbed rejection; **Forgot password?** (a button — it swaps the sign-in card for the reset form in place, URL stays `/login`) returns a privacy-safe confirmation; the standalone `/forgot-password` page still works for links that point at it; a valid reset link exposes a usable password form | Catches broken field wiring and recovery regressions with stubbed API responses, without consuming the server login throttle, changing a password, or sending email |
| Authenticated routing | All 43 staff routes declared by `App.jsx`, including operations, fleet, warehouse, finance, master data, reports, audit, and settings | Each route must stay on its intended URL, render meaningful main content, and avoid access-denied output for the seeded system administrator |
| Runtime health | Every routed case collects uncaught page exceptions, unexpected console errors, API request failures, and first-party HTTP 4xx/5xx responses | Converts silent white screens, rejected app requests, and backend crashes into test failures with route-level attribution |
| Create surfaces | Explicitly allow-listed primary actions on Operations, Fleet, Warehouse, Finance, Master Data, and Administration pages — including **Invite User** (users are invited by email) | Opens the empty create/schedule/record form and exits through Cancel; never submits or changes a record |
| Navigating actions | **New Client Setup** on Companies (a company is created by a wizard page, not a modal) | Lands on the wizard with its heading and comes back; creates nothing |
| Global shell | Theme choice, sidebar collapse, top/side navigation switch, notifications panel, and account menu | Verifies persisted shell preferences and the controls shared by every staff page |
| Role visibility (`role-visibility.spec.js`) | **Invite User** and **New Client Setup** as a System Administrator, a company administrator who is not one, a read-only user manager, and a role with no user-management access | The button is there for exactly the roles that should have it; a user who types the wizard's address without `system.admin` is kept out |
| Search (`search-and-export.spec.js`, `search-restricted.spec.js`) | Ctrl/⌘+K and the top-bar button open the palette; Enter jumps to a page; a role without `trip.read` gets a pages-only palette and the browser never asks for trips; a server 403 or 500 is reported plainly (not as "No matches") and 500 is retryable; the trip search endpoint refuses no sign-in and a bad token, returns an empty list for a too-short term or a bare `%`, returns only the lean fields, and will not search a branch the caller does not belong to; a real ticket number is found | Covers both layers of the access model — what the console hides and what the API refuses |
| Trips export | Export CSV downloads what is on screen with the expected header | Skips when there are no trips |

## Safety boundaries and deliberate exclusions

- No create, update, delete, approve, dispatch, release, receive, post, send,
  payment, or status-transition request is submitted. Those workflows require a
  dedicated disposable test database and fixture cleanup.
- Password-recovery delivery is stubbed in browser QA. Token issuance, expiry,
  one-time use, password validation, and non-enumerating responses are covered
  by focused backend/frontend tests; real inbox delivery remains an environment
  acceptance test once a mail provider is selected.
- Browser smoke cannot prove a physical Android/iOS phone's GPS accuracy,
  permission state, background execution, battery behavior, or carrier/network
  handoff. Live tracking needs a separate field test using a real driver phone.
- Apart from the Trips CSV export (a read-only download of what is on screen), the suite does not click external links, download/export controls, upload
  documents/photos, or send emails/notifications because those actions have
  external side effects.
- Map tile/geocoder rendering from third-party providers is not a release
  failure here; application JavaScript errors and Trackify API failures still
  are. WebSocket and GPS-ping semantics belong in focused tracking integration
  tests.

This is a high-value automated regression gate, not a claim that every possible
button/data combination has been manually certified.
