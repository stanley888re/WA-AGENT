import { Router, Request } from "express";
import { db } from "@workspace/db";
import { knowledgeDocsTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router({ mergeParams: true });

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

/** Verify the agent belongs to the authenticated user — prevents BOLA */
async function assertAgentOwnership(agentId: number, userId: number): Promise<boolean> {
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
  return !!agent;
}

const createDocSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(50),
  size: z.number().int().positive(),
  content: z.string().max(500_000).optional(),
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentId = Number((req.params as { agentId: string }).agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return res.status(400).json({ error: "Invalid agentId" });

  if (!(await assertAgentOwnership(agentId, userId))) {
    return res.status(403).json({ error: "Interdit" });
  }

  const docs = await db.select().from(knowledgeDocsTable).where(eq(knowledgeDocsTable.agentId, agentId));
  return res.json(docs.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentId = Number((req.params as { agentId: string }).agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return res.status(400).json({ error: "Invalid agentId" });

  if (!(await assertAgentOwnership(agentId, userId))) {
    return res.status(403).json({ error: "Interdit" });
  }

  const parsed = createDocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const { name, type, size, content } = parsed.data;
  const [doc] = await db.insert(knowledgeDocsTable).values({ agentId, name, type, size, content }).returning();
  return res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
});

router.delete("/:docId", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentId = Number((req.params as { agentId: string; docId: string }).agentId);
  const docId = Number((req.params as { agentId: string; docId: string }).docId);
  if (!Number.isInteger(agentId) || agentId <= 0 || !Number.isInteger(docId) || docId <= 0) {
    return res.status(400).json({ error: "Invalid params" });
  }

  if (!(await assertAgentOwnership(agentId, userId))) {
    return res.status(403).json({ error: "Interdit" });
  }

  await db.delete(knowledgeDocsTable).where(
    and(eq(knowledgeDocsTable.id, docId), eq(knowledgeDocsTable.agentId, agentId)),
  );
  return res.status(204).send();
});

export default router;
