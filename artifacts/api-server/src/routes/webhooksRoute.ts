import { Router, Request } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { webhooksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

// ── SSRF guard ───────────────────────────────────────────────────────────────
// Reject private/loopback/link-local ranges and non-HTTP(S) schemes so that
// the server cannot be used to probe internal infrastructure.
// We check parsed.hostname (not the raw string) to prevent bypasses via
// userinfo tricks like http://attacker@127.0.0.1/ or URL-encoded variants.
// IPv6 literals arrive wrapped in [] — strip those before matching.

const PRIVATE_HOSTNAME_RE = /^(127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|169\.254(\.\d+){2}|0\.0\.0\.0|::1|fc[0-9a-f]{2}:.+|fd[0-9a-f]{2}:.+|fe80:.+|localhost)$/i;

function validateWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "url doit être une chaîne" };
  if (raw.length > 2048) return { ok: false, error: "url trop longue (max 2048 caractères)" };

  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, error: "url invalide" }; }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Seuls les schémas http et https sont autorisés" };
  }

  // hostname includes brackets for IPv6 literals — strip them for matching
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (PRIVATE_HOSTNAME_RE.test(hostname)) {
    return { ok: false, error: "Les adresses IP privées/internes ne sont pas autorisées" };
  }

  // Block numeric IPv4 that resolves to private ranges (octal / hex / decimal encoding)
  // by rejecting any hostname that is purely numeric dots — let only public FQDNs through
  // if they look like a raw IPv4 that slipped past the regex above.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return { ok: false, error: "Les adresses IP privées/internes ne sont pas autorisées" };
    }
  }

  return { ok: true, url: raw };
}

const ALLOWED_EVENTS = ["new_lead", "new_conversation", "new_message", "order_placed", "appointment_created", "agent_error", "handoff_request"] as const;
const EventsSchema = z.array(z.enum(ALLOWED_EVENTS)).max(20).optional().default([]);

const CreateWebhookBody = z.object({
  url:    z.string(),
  events: EventsSchema,
});

const UpdateWebhookBody = z.object({
  url:    z.string().optional(),
  events: EventsSchema.optional(),
  active: z.boolean().optional(),
});

const toJson = (w: typeof webhooksTable.$inferSelect) => ({
  ...w,
  events: JSON.parse(w.events || "[]") as string[],
  createdAt: w.createdAt.toISOString(),
  lastPingedAt: w.lastPingedAt?.toISOString() ?? null,
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const items = await db.select().from(webhooksTable)
    .where(eq(webhooksTable.userId, userId))
    .orderBy(webhooksTable.createdAt);
  return res.json(items.map(toJson));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });

  const parsed = CreateWebhookBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const urlCheck = validateWebhookUrl(parsed.data.url);
  if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });

  const secret = "whsec_" + crypto.randomBytes(16).toString("hex");
  const [item] = await db.insert(webhooksTable).values({
    userId,
    url: urlCheck.url,
    events: JSON.stringify(parsed.data.events),
    active: true,
    secret,
    lastStatus: "pending",
  }).returning();
  return res.status(201).json(toJson(item));
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });

  const parsed = UpdateWebhookBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  if (parsed.data.url !== undefined) {
    const urlCheck = validateWebhookUrl(parsed.data.url);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });
  }

  const [item] = await db.update(webhooksTable)
    .set({
      ...(parsed.data.url   !== undefined && { url: parsed.data.url }),
      ...(parsed.data.events !== undefined && { events: JSON.stringify(parsed.data.events) }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
    })
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)))
    .returning();
  if (!item) return res.status(404).json({ error: "not found" });
  return res.json(toJson(item));
});

router.post("/:id/ping", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });

  const [wh] = await db.select().from(webhooksTable)
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)));
  if (!wh) return res.status(404).json({ error: "not found" });

  // Re-validate URL before hitting it (in case it was set before validation existed)
  const urlCheck = validateWebhookUrl(wh.url);
  if (!urlCheck.ok) return res.status(400).json({ error: `URL stockée invalide: ${urlCheck.error}` });

  const payload = { event: "ping", timestamp: new Date().toISOString(), webhookId: id };
  let status: "success" | "error" = "error";
  try {
    const signature = crypto.createHmac("sha256", wh.secret).update(JSON.stringify(payload)).digest("hex");
    const response = await fetch(wh.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": `sha256=${signature}`, "X-Webhook-Event": "ping" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    status = response.ok ? "success" : "error";
  } catch { /* network error — status stays "error" */ }

  const [updated] = await db.update(webhooksTable)
    .set({ lastStatus: status, lastPingedAt: new Date() })
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)))
    .returning();
  return res.json({ success: status === "success", webhook: toJson(updated) });
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
  await db.delete(webhooksTable).where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)));
  return res.status(204).send();
});

export default router;
