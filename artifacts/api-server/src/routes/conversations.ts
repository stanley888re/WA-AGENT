import { Router, Request } from "express";
import { db } from "@workspace/db";
import { conversationsTable, messagesTable, agentsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { waManager } from "../services/whatsapp";
import { z } from "zod/v4";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

async function getUserAgentIds(userId: number): Promise<number[]> {
  const rows = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.userId, userId));
  return rows.map(r => r.id);
}

/**
 * Fetch a conversation and verify it belongs to one of the user's agents.
 * Returns the conversation or null if not found / not owned.
 */
async function getOwnedConversation(convId: number, userId: number) {
  const agentIds = await getUserAgentIds(userId);
  if (agentIds.length === 0) return null;
  const [convo] = await db.select().from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), inArray(conversationsTable.agentId, agentIds)));
  return convo ?? null;
}

function convToJson(c: typeof conversationsTable.$inferSelect) {
  return {
    id: c.id,
    agentId: c.agentId,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    mode: c.mode,
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    agentName: c.agentName,
    messageCount: c.messageCount,
    conversationSummary: c.conversationSummary ?? null,
  };
}

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentIds = await getUserAgentIds(userId);
  if (agentIds.length === 0) return res.json([]);
  const convos = await db.select().from(conversationsTable)
    .where(inArray(conversationsTable.agentId, agentIds))
    .orderBy(conversationsTable.lastMessageAt);
  return res.json(convos.map(convToJson));
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return res.status(404).json({ error: "Not found" });

  const messages = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);
  return res.json({
    id: convo.id,
    agentId: convo.agentId,
    contactName: convo.contactName,
    contactPhone: convo.contactPhone,
    mode: convo.mode,
    agentName: convo.agentName,
    conversationSummary: convo.conversationSummary ?? null,
    messages: messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
});

// ─── PATCH /:id/summary ───────────────────────────────────────────────────────
const summarySchema = z.object({ conversationSummary: z.string().max(5000).nullable().optional() });

router.patch("/:id/summary", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return res.status(404).json({ error: "Not found" });

  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const [updated] = await db.update(conversationsTable)
    .set({ conversationSummary: parsed.data.conversationSummary ?? null })
    .where(eq(conversationsTable.id, id))
    .returning();
  return res.json(convToJson(updated));
});

// ─── PATCH /:id/mode ──────────────────────────────────────────────────────────
const modeSchema = z.object({ mode: z.enum(["automatic", "manual"]) });

router.patch("/:id/mode", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return res.status(404).json({ error: "Not found" });

  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const { mode } = parsed.data;
  const [updated] = await db.update(conversationsTable)
    .set({ mode })
    .where(eq(conversationsTable.id, id))
    .returning();

  // Notify admin when human takes over
  if (mode === "manual" && updated.agentId) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, updated.agentId));
    const notifPhone = agent?.notificationPhone?.trim();
    if (notifPhone) {
      const msg =
        `🙋 *Prise en main humaine*\n` +
        `👤 Contact : ${updated.contactName || updated.contactPhone}\n` +
        `📱 Tél : ${updated.contactPhone}\n` +
        `🤖 Agent : ${agent.personaName || agent.name}\n` +
        `ℹ️ L'IA est désactivée sur cette conversation.`;
      waManager.sendMessageToJid(updated.agentId, `${notifPhone.replace(/\D/g, "")}@s.whatsapp.net`, msg).catch(() => {});
    }
  }

  return res.json(convToJson(updated));
});

// ─── POST /:id/messages ───────────────────────────────────────────────────────
const messageSchema = z.object({ content: z.string().min(1).max(10_000) });

router.post("/:id/messages", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return res.status(404).json({ error: "Not found" });

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const [message] = await db.insert(messagesTable).values({
    conversationId: id,
    role: "user",
    content: parsed.data.content,
  }).returning();
  await db.update(conversationsTable)
    .set({ lastMessage: parsed.data.content, lastMessageAt: new Date() })
    .where(eq(conversationsTable.id, id));
  return res.status(201).json({ ...message, createdAt: message.createdAt.toISOString() });
});

// ─── POST /:id/send ───────────────────────────────────────────────────────────
router.post("/:id/send", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return res.status(404).json({ error: "Not found" });

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const content = parsed.data.content.trim();

  const updates: Partial<typeof conversationsTable.$inferInsert> = {
    lastMessage: content,
    lastMessageAt: new Date(),
    messageCount: (convo.messageCount ?? 0) + 1,
  };

  if (convo.agentId) {
    const [agent] = await db.select({ autoHandoff: agentsTable.autoHandoff })
      .from(agentsTable)
      .where(eq(agentsTable.id, convo.agentId));
    if (agent?.autoHandoff) {
      updates.mode = "manual";
    }
  }

  await db.update(conversationsTable).set(updates).where(eq(conversationsTable.id, id));

  const [message] = await db.insert(messagesTable).values({
    conversationId: id,
    role: "human",
    content,
  }).returning();

  if (convo.jid && convo.agentId) {
    const sent = await waManager.sendMessageToJid(convo.agentId, convo.jid, content);
    if (!sent) {
      console.warn(`[Conversations] Could not send via WhatsApp for conv ${id}`);
    }
  }

  return res.status(201).json({ ...message, createdAt: message.createdAt.toISOString() });
});

export default router;
