import { Router, Request } from "express";
import { db } from "@workspace/db";
import { templatesTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

const toJson = (t: typeof templatesTable.$inferSelect) => ({
  ...t,
  createdAt: t.createdAt.toISOString(),
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const items = await db.select().from(templatesTable)
    .where(eq(templatesTable.userId, userId))
    .orderBy(templatesTable.createdAt);
  return res.json(items.map(toJson));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const { title, content, category, shortcut, agentId } = req.body as {
    title: string; content: string; category?: string; shortcut?: string; agentId?: number;
  };
  if (!title || typeof title !== "string" || title.trim().length === 0)
    return res.status(400).json({ error: "title est requis" });
  if (!content || typeof content !== "string" || content.trim().length === 0)
    return res.status(400).json({ error: "content est requis" });

  // Validate agentId ownership — prevent IDOR (linking template to another user's agent)
  let resolvedAgentId: number | null = null;
  if (agentId !== undefined && agentId !== null) {
    const parsed = Number(agentId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ error: "agentId doit être un entier positif" });
    }
    const [owned] = await db.select({ id: agentsTable.id }).from(agentsTable)
      .where(and(eq(agentsTable.id, parsed), eq(agentsTable.userId, userId)));
    if (!owned) return res.status(403).json({ error: "Agent introuvable ou accès refusé" });
    resolvedAgentId = parsed;
  }

  const [item] = await db.insert(templatesTable).values({
    userId,
    title: title.trim(), content: content.trim(),
    category: category || "Autre",
    shortcut: shortcut || null,
    agentId: resolvedAgentId,
  }).returning();
  return res.status(201).json(toJson(item));
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  const { title, content, category, shortcut } = req.body as {
    title?: string; content?: string; category?: string; shortcut?: string;
  };
  const [item] = await db.update(templatesTable)
    .set({
      ...(title && { title }),
      ...(content && { content }),
      ...(category && { category }),
      ...(shortcut !== undefined && { shortcut }),
    })
    .where(and(eq(templatesTable.id, id), eq(templatesTable.userId, userId)))
    .returning();
  if (!item) return res.status(404).json({ error: "not found" });
  return res.json(toJson(item));
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  await db.delete(templatesTable).where(and(eq(templatesTable.id, id), eq(templatesTable.userId, userId)));
  return res.status(204).send();
});

export default router;
