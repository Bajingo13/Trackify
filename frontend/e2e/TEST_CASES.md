# Trackify web release-readiness cases

This Playwright suite is a repeatable, non-destructive browser gate for the
staff web application. It defaults to `http://localhost:8444`, runs against the
installed Chrome channel, and intentionally uses one worker so shared seeded
data and login throttling remain predictable.

## Running the suite

Start the current frontend and backend, then run:

```powershell
$env:TRACKIFY_WEB_URL = "http://localhost:8444"
$env:TRACKIFY_API_URL = "http://localhost:5001"
npm --prefix frontend run test:e2e:web
```

The documented local demo staff account is the fallback. For any other seeded
environment, set `TRACKIFY_TEST_EMAIL` and `TRACKIFY_TEST_PASSWORD`. The suite
does not print either credential. Use `npm --prefix frontend run
test:e2e:web:list` to review coverage without contacting the app.

Authenticated Playwright traces are off by default because they can retain
bearer-token request headers. For local debugging with a disposable account,
set `TRACKIFY_E2E_TRACE=1`; artifacts stay under the operating system's temp
directory rather than the repository.

## Coverage map

| Area | Cases | Release signal |
| --- | --- | --- |
| Staff login | Email/password fields render; password show/hide works; Remember Me persistence behavior is exercised with a stubbed rejection | Catches broken field wiring and accidental credential-display regressions without consuming the server login throttle |
| Authenticated routing | All 43 staff routes declared by `App.jsx`, including operations, fleet, warehouse, finance, master data, reports, audit, and settings | Each route must stay on its intended URL, render meaningful main content, and avoid access-denied output for the seeded system administrator |
| Runtime health | Every routed case collects uncaught page exceptions, unexpected console errors, API request failures, and first-party HTTP 4xx/5xx responses | Converts silent white screens, rejected app requests, and backend crashes into test failures with route-level attribution |
| Create surfaces | Explicitly allow-listed primary actions on Operations, Fleet, Warehouse, Finance, Master Data, and Administration pages | Opens the empty create/schedule/record form and exits through Cancel; never submits or changes a record |
| Global shell | Theme choice, sidebar collapse, top/side navigation switch, notifications panel, and account menu | Verifies persisted shell preferences and the controls shared by every staff page |

## Safety boundaries and deliberate exclusions

- No create, update, delete, approve, dispatch, release, receive, post, send,
  payment, or status-transition request is submitted. Those workflows require a
  dedicated disposable test database and fixture cleanup.
- Forgot Password is marked `fixme`, not passed: the current UI link points to
  `#`, and there is no recovery screen/API to prove yet.
- Browser smoke cannot prove a physical Android/iOS phone's GPS accuracy,
  permission state, background execution, battery behavior, or carrier/network
  handoff. Live tracking needs a separate field test using a real driver phone.
- The suite does not click external links, download/export controls, upload
  documents/photos, or send emails/notifications because those actions have
  external side effects.
- Map tile/geocoder rendering from third-party providers is not a release
  failure here; application JavaScript errors and Trackify API failures still
  are. WebSocket and GPS-ping semantics belong in focused tracking integration
  tests.

This is a high-value automated regression gate, not a claim that every possible
button/data combination has been manually certified.
