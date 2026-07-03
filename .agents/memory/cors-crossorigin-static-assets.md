---
name: CORS breaking same-origin static assets
description: Global CORS middleware combined with Vite's crossorigin script/link tags can 500 the entire app on hosts where ALLOWED_ORIGINS isn't set
---

Vite tags `<script type="module" crossorigin>` and `<link crossorigin>` in the built `index.html`. The `crossorigin` attribute makes browsers send an `Origin` header even for same-origin asset requests (same site, same host).

If a CORS middleware is mounted globally (not scoped to `/api`) and rejects unrecognized origins by throwing an error, that error hits the app's generic error handler and returns a JSON 500 body in place of the JS/CSS file — the browser then refuses to execute/apply it (wrong MIME type), and the page is blank. This reproduces consistently (not related to cold starts/spin-down) and is easy to misdiagnose as a hosting/infra issue since curl/fetch checks succeed (they don't send `crossorigin`-triggered browser behavior) while real browsers fail.

**Why:** A deploy target (e.g. Render) not having an `ALLOWED_ORIGINS` env var manually configured is enough to trigger this, since the app's own production URL is then "unrecognized." The failure looks identical to a server crash from the outside (500 on asset load) but the server logs show no actual crash.

**How to apply:**
1. Scope CORS middleware to `/api` only — static assets and HTML never need CORS.
2. On `/api`, always allow same-origin requests by comparing the `Origin` header against `${req.protocol}://${req.get("host")}`, rather than relying solely on an operator-maintained allowlist env var. This makes the app work correctly out of the box on any host without needing per-host CORS config, while still enforcing the allowlist for genuinely cross-origin callers.
3. Never let a rejected CORS origin throw into the generic error handler — reject via `callback(null, { origin: false })`, not `callback(new Error(...))`, so disallowed origins just don't get CORS headers instead of breaking the whole response.
