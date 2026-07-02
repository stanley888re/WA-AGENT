---
name: Security hardening
description: What was secured, key decisions, and one gotcha with zod resolution in the api-server esbuild bundle.
---

## What was hardened (app.ts / auth.ts / whatsapp.ts / products.ts)

- **Helmet** added with CSP; `fontSrc` must include `fonts.gstatic.com` and `styleSrc` must include `fonts.googleapis.com` to avoid breaking the frontend in production.
- **CORS** changed from `origin: true` (reflect all) to explicit whitelist via `ALLOWED_ORIGINS` env var + localhost in dev only. No wildcard Replit domain with `credentials: true` — that allows any Replit user subdomain to make authenticated requests.
- **Rate limiting** (express-rate-limit): 15 req/15 min on auth routes, 200 req/min on general API.
- **Body size limits**: `express.json({ limit: "500kb" })`, `express.urlencoded({ limit: "100kb" })`.
- **SESSION_SECRET fallback removed** — throws on startup if not set.
- **ADMIN_EMAILS** moved to env var `ADMIN_EMAILS` (comma-separated). Previously hardcoded in source.
- **AI_API_URL** moved to env var. Was hardcoded `https://delfaapiai.vercel.app/ai/copilot` in two places in whatsapp.ts.
- **Zod validation** on `/register` and `/login` (min 8-char password, email format, max lengths).
- **timingSafeEqual** for password comparison — with pre-check that both hashes are valid 128-char hex strings to avoid throw on malformed DB value.
- **File upload MIME validation**: only jpeg/png/webp/gif allowed in multer fileFilter.
- **Global error handler** added — hides stack traces in production.

## Gotcha: zod in api-server esbuild bundle

`zod/v4` subpath works in `lib/` packages (compiled by tsc separately) but esbuild in `artifacts/api-server/build.mjs` cannot resolve it unless `zod` is a **direct dependency** of `@workspace/api-server`. Fix: `pnpm --filter @workspace/api-server add zod`. Use `import { z } from "zod/v4"` after that.

**Why:** esbuild bundles everything for the api-server. Transitive zod from workspace libs is not in scope for the api-server's own source files.

## Required env vars (all in shared)
- `SESSION_SECRET` — secret key (Replit secret)
- `ADMIN_EMAILS` — comma-separated admin emails
- `AI_API_URL` — AI copilot endpoint
- `ALLOWED_ORIGINS` — comma-separated allowed CORS origins (for production deployments)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — Cloudinary (Replit secrets)
