import { Router, Request } from "express";
import { db } from "@workspace/db";
import { blacklistTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

const toJson = (b: typeof blacklistTable.$inferSelect) => ({
  ...b,
  createdAt: b.createdAt.toISOString(),
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const items = await db.select().from(blacklistTable)
    .where(eq(blacklistTable.userId, userId))
    .orderBy(blacklistTable.createdAt);
  return res.json(items.map(toJson));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const { phone, reason } = req.body as { phone: string; reason?: string };
  if (!phone) return res.status(400).json({ error: "phone required" });
  // Validate phone format: digits only, 6–15 chars (E.164 without the +)
  if (!/^\d{6,15}$/.test(phone.trim())) {
    return res.status(400).json({ error: "Format de numéro invalide (chiffres uniquement, 6 à 15 caractères)" });
  }
  try {
    const [item] = await db.insert(blacklistTable).values({
      userId,
      phone: phone.trim(),
      reason: reason || "Pas de raison spécifiée",
    }).returning();
    return res.status(201).json(toJson(item));
  } catch {
    return res.status(409).json({ error: "Ce numéro est déjà dans la liste noire" });
  }
});

router.post("/bulk", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const { phones, reason } = req.body as { phones: unknown; reason?: string };
  if (!Array.isArray(phones) || phones.length === 0) return res.status(400).json({ error: "phones array required" });
  if (phones.length > 500) return res.status(400).json({ error: "Maximum 500 numéros par requête" });
  const PHONE_RE = /^\d{6,15}$/;
  const invalidPhone = (phones as unknown[]).find(p => typeof p !== "string" || !PHONE_RE.test((p as string).trim()));
  if (invalidPhone !== undefined) {
    return res.status(400).json({ error: "Un ou plusieurs numéros ont un format invalide (chiffres uniquement, 6 à 15 caractères)" });
  }
  const results = [];
  for (const phone of phones as string[]) {
    try {
      const [item] = await db.insert(blacklistTable).values({
        userId,
        phone: phone.trim(),
        reason: reason || "Ajout en masse",
      }).returning();
      results.push(toJson(item));
    } catch { /* skip duplicates */ }
  }
  return res.status(201).json({ added: results.length, items: results });
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  await db.delete(blacklistTable).where(and(eq(blacklistTable.id, id), eq(blacklistTable.userId, userId)));
  return res.status(204).send();
});

export default router;
