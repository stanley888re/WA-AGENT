---
name: Security hardening
description: All security fixes applied to the WA Agent platform — patterns to preserve and re-apply consistently.
---

## Applied security layers (api-server)

**app.ts**
- Helmet with CSP (Google Fonts whitelisted)
- Strict CORS whitelist from `ALLOWED_ORIGINS` env var — no wildcard
- Rate limiting: 15 req/15min on auth routes, 200/min on API
- Body size limits: 500 kb JSON, 100 kb urlencoded
- SESSION_SECRET required (throws on start if absent)
- Global error handler: stack traces hidden in production

**auth.ts**
- ADMIN_EMAILS from env var (not hardcoded)
- Zod validation on /register (email, min 8-char password) and /login
- `crypto.timingSafeEqual` with hex format pre-check

**Authorization pattern — BOLA prevention**
- All DB routes filter by `session.userId`
- knowledge.ts, agentProducts.ts: `assertAgentOwnership(agentId, userId)` before any operation
- conversations.ts: `getOwnedConversation(id, userId)` on all PATCH/POST
- blacklist.ts: `eq(blacklistTable.userId, userId)` on all mutations + phone regex `/^\d{6,15}$/` + 500 max bulk
- calendar.ts: `requireAdmin` middleware — Google Calendar is platform-level, not per-user
- agents.ts: all routes use `and(eq(agentsTable.id, id), eq(agentsTable.userId, userId))`
- webhooksRoute.ts: `eq(webhooksTable.userId, userId)` on all mutations
- notificationsRoute.ts: `eq(notificationSettingsTable.userId, userId)` on all mutations

**Input validation**
- Zod on all routes that accept user input
- notificationsRoute.ts: `frequency` validated as `z.enum(["instant","hourly","daily"])` — previously any string
- calendar.ts: Zod on POST body (date regex YYYY-MM-DD, time HH:MM)
- webhooksRoute.ts: allowed events enumerated in `ALLOWED_EVENTS` const

**XSS**
- widgets.ts: `escapeHtmlAttr()` applied to all user-supplied values in embed script snippet

**SSRF (webhooksRoute.ts)**
- Validate `parsed.hostname` (not raw string) to block userinfo bypass tricks like `http://attacker@127.0.0.1/`
- Strip `[]` from IPv6 literals before matching
- Reject private ranges: 10/8, 172.16-31, 192.168, 127, 169.254, ::1, fc/fd/fe80, localhost
- Also parse numeric IPv4 parts to catch octal/decimal-encoded private addresses
- Re-validate stored URL at ping time (covers legacy records)

**Error handling**
- No `String(err)` in responses — use `err instanceof Error ? err.message.slice(0, 200) : "Erreur interne"`
- broadcast.ts: per-lead errors logged internally only, client gets "Échec d'envoi"
- calendar.ts: all catch blocks use `safeError()` helper + log internally

**Path traversal**
- whatsapp.ts: `Math.floor(Math.abs(Number(agentId)))` before embedding agentId in path.join

**Why:** Platform has multiple users sharing one server. Every route must enforce ownership or an attacker
who registers an account can read/modify other users' data (BOLA), probe internal infrastructure (SSRF),
or inject content into other users' embeds (XSS).

**How to apply:** For every new route: (1) check userId from session, (2) add userId to WHERE clause,
(3) add Zod schema, (4) never return String(err) or stack traces, (5) for any server-side HTTP call validate
the target URL with the SSRF guard in webhooksRoute.ts.
