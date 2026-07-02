import { Router, Request } from "express";
import { db } from "@workspace/db";
import { agentsTable, agentProductsTable, productsTable, appointmentsTable, ordersTable } from "@workspace/db";
import { tryFallbackAppointmentExtract } from "../services/whatsapp.js";
import { eq, inArray, and } from "drizzle-orm";
import {
  GetAgentParams,
  UpdateAgentParams,
  UpdateAgentBody,
  DeleteAgentParams,
  TestAgentParams,
  TestAgentBody,
  CreateAgentBody,
} from "@workspace/api-zod";
import { waManager, callAI } from "../services/whatsapp";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

// Update DB when WhatsApp connects successfully
waManager.on("connected", async (agentId: number, phone: string | null) => {
  try {
    await db.update(agentsTable)
      .set({ whatsappConnected: true, whatsappPhone: phone })
      .where(eq(agentsTable.id, agentId));
    console.log(`[Agents] DB updated: agent ${agentId} connected, phone=${phone}`);
  } catch (err) {
    console.error(`[Agents] Failed to update DB for agent ${agentId}:`, err);
  }
});

// Called by index.ts after migrations complete — avoids race with ALTER TABLE
export async function autoReconnectAgents(): Promise<void> {
  try {
    const connectedAgents = await db.select().from(agentsTable)
      .then(rows => rows.filter(a => a.whatsappConnected && a.isActive));
    if (connectedAgents.length === 0) return;
    console.log(`[Agents] Auto-reconnecting ${connectedAgents.length} agent(s)...`);
    for (const agent of connectedAgents) {
      try {
        await waManager.startSession(agent.id);
        console.log(`[Agents] Auto-reconnect started for agent ${agent.id} (${agent.name})`);
      } catch (err) {
        console.error(`[Agents] Auto-reconnect failed for agent ${agent.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Agents] Auto-reconnect error:", err);
  }
}

const router = Router();

const agentToJson = (a: typeof agentsTable.$inferSelect) => ({
  ...a,
  createdAt: a.createdAt.toISOString(),
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agents = await db.select().from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .orderBy(agentsTable.createdAt);
  return res.json(agents.map(agentToJson));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [agent] = await db.insert(agentsTable).values({
    userId,
    name: parsed.data.name,
    model: parsed.data.model,
    communicationStyle: parsed.data.communicationStyle,
    prompt: parsed.data.prompt,
    timezone: parsed.data.timezone,
    responseDelay: parsed.data.responseDelay,
    emojiReactions: parsed.data.emojiReactions ?? false,
    emojiList: parsed.data.emojiList,
  }).returning();
  return res.status(201).json(agentToJson(agent));
});

router.get("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = GetAgentParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Not found" });
  return res.json(agentToJson(agent));
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = UpdateAgentParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const validStyles = ["amical", "normal", "direct", "pedagogical"];
  if (req.body && (req.body.communicationStyle === "" || !validStyles.includes(req.body.communicationStyle))) {
    req.body.communicationStyle = "amical";
  }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const [agent] = await db.update(agentsTable)
    .set({
      ...(d.name !== undefined && { name: d.name }),
      ...(d.model !== undefined && { model: d.model }),
      ...(d.communicationStyle !== undefined && { communicationStyle: d.communicationStyle }),
      ...(d.prompt !== undefined && { prompt: d.prompt }),
      ...(d.isActive !== undefined && { isActive: d.isActive }),
      ...(d.timezone !== undefined && { timezone: d.timezone }),
      ...(d.responseDelay !== undefined && { responseDelay: d.responseDelay }),
      ...(d.emojiReactions !== undefined && { emojiReactions: d.emojiReactions }),
      ...(d.emojiList !== undefined && { emojiList: d.emojiList }),
      ...(d.language !== undefined && { language: d.language }),
      ...(d.greetingMessage !== undefined && { greetingMessage: d.greetingMessage }),
      ...(d.fallbackMessage !== undefined && { fallbackMessage: d.fallbackMessage }),
      ...(d.maxResponseLength !== undefined && { maxResponseLength: d.maxResponseLength }),
      ...(d.personaName !== undefined && { personaName: d.personaName }),
      ...(d.workingHoursStart !== undefined && { workingHoursStart: d.workingHoursStart }),
      ...(d.workingHoursEnd !== undefined && { workingHoursEnd: d.workingHoursEnd }),
      ...(d.autoHandoff !== undefined && { autoHandoff: d.autoHandoff }),
      ...(d.handoffMessage !== undefined && { handoffMessage: d.handoffMessage }),
      ...(d.messageFrequencyLimit !== undefined && { messageFrequencyLimit: d.messageFrequencyLimit }),
      ...((d as { resources?: string }).resources !== undefined && { resources: (d as { resources?: string }).resources }),
      ...((d as { notificationPhone?: string }).notificationPhone !== undefined && { notificationPhone: (d as { notificationPhone?: string }).notificationPhone }),
    })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, userId)))
    .returning();
  if (!agent) return res.status(404).json({ error: "Not found" });
  return res.json(agentToJson(agent));
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = DeleteAgentParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Not found" });
  await waManager.stopSession(params.data.id, true);
  await db.delete(agentsTable).where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, userId)));
  return res.status(204).send();
});

router.post("/:id/qr/start", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Agent introuvable" });
  if (agent.whatsappConnected) {
    return res.json({ status: "connected", phone: agent.whatsappPhone });
  }
  const session = await waManager.startSession(id);
  return res.json({ status: session.status, qrCode: session.qrCode });
});

router.get("/:id/qr/status", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Agent introuvable" });
  if (agent.whatsappConnected) {
    return res.json({ status: "connected", phone: agent.whatsappPhone, qrCode: null, pairingCode: null });
  }
  const session = waManager.getSession(id);
  if (!session) return res.json({ status: "idle", qrCode: null, pairingCode: null });
  return res.json({ status: session.status, qrCode: session.qrCode, pairingCode: session.pairingCode, phone: session.phone, error: session.lastError });
});

router.post("/:id/pair", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const phone = (req.body as { phone?: string }).phone;
  if (!phone || typeof phone !== "string") return res.status(400).json({ error: "Numéro de téléphone requis" });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Agent introuvable" });
  try {
    // Always start from a clean slate for pairing:
    //  1. Stop any running session (kills socket + reconnect timer)
    //  2. Wipe stored auth credentials so Baileys starts completely fresh
    //     (stale/partial creds cause WA to reject immediately with no QR/code)
    await waManager.stopSession(id);
    await waManager.clearSessionCreds(id);

    // Start a brand-new session (no prior creds → Baileys will reach out to WA servers)
    await waManager.startSession(id);

    // Wait for Baileys to connect to WA servers and emit QR (status = qr_ready).
    // On deployed servers (Render, Railway…) the first TCP handshake can be slow.
    await waManager.waitForSessionReady(id, 40000);

    // Exchange the QR challenge for a pairing code bound to the given phone number.
    // The user then enters this code in WhatsApp → Linked devices → Link with phone number.
    const code = await waManager.requestPairingCode(id, phone);
    return res.json({ code });
  } catch (err) {
    console.error(`[Agents] /pair failed for agent ${id}:`, err);
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Erreur lors de la génération du code de couplage";
    return res.status(500).json({ error: msg });
  }
});

router.post("/:id/disconnect", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await waManager.stopSession(id);
  const [agent] = await db.update(agentsTable)
    .set({ whatsappConnected: false, whatsappPhone: null })
    .where(and(eq(agentsTable.id, id), eq(agentsTable.userId, userId)))
    .returning();
  if (!agent) return res.status(404).json({ error: "Not found" });
  return res.json(agentToJson(agent));
});

router.post("/:id/test", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = TestAgentParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const parsed = TestAgentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Not found" });

  try {
    const history: { role: string; content: string }[] = (parsed.data as { message: string; history?: { role: string; content: string }[] }).history ?? [];
    const agentData = agent as typeof agent & { resources?: string | null };

    let productContext = agentData.resources || null;
    const agentProductLinks = await db
      .select({ productId: agentProductsTable.productId })
      .from(agentProductsTable)
      .where(eq(agentProductsTable.agentId, params.data.id));

    if (agentProductLinks.length > 0) {
      const productIds = agentProductLinks.map(r => r.productId);
      const agentProds = await db.select().from(productsTable)
        .where(inArray(productsTable.id, productIds));

      const prodLines = agentProds
        .filter(p => (p as typeof p & { status?: string }).status === "active")
        .map(p => {
          const prod = p as typeof p & { description?: string | null; category?: string | null; link?: string | null };
          let line = `• ${p.name} — ${Number(p.price).toFixed(2)} €`;
          if (prod.description) line += ` | ${prod.description}`;
          if (prod.category) line += ` [${prod.category}]`;
          if (prod.link) line += ` | Lien: ${prod.link}`;
          return line;
        });

      if (prodLines.length > 0) {
        const prodSection = `=== CATALOGUE PRODUITS DE CET AGENT ===\n${prodLines.join("\n")}\n`;
        productContext = productContext ? `${productContext}\n\n${prodSection}` : prodSection;
      }
    }

    const rawResponse = await callAI(agent.prompt ?? "", history, parsed.data.message, agent.personaName || agent.name, productContext);

    const apptMatch = rawResponse.match(/\[APPT:\s*(\{[\s\S]*?\})\]/);
    const orderMatch = rawResponse.match(/\[ORDER:\s*(\{[\s\S]*?\})\]/);
    const cleanResponse = rawResponse
      .replace(/\n?\[APPT:\s*\{[\s\S]*?\}\]/g, "")
      .replace(/\n?\[ORDER:\s*\{[\s\S]*?\}\]/g, "")
      .trim();

    let apptCreated = false;
    let orderCreated = false;

    if (apptMatch) {
      try {
        const apptData = JSON.parse(apptMatch[1]) as { clientName?: string; date?: string; time?: string; notes?: string };
        if (apptData.clientName && apptData.date && apptData.time) {
          await db.insert(appointmentsTable).values({
            agentId: params.data.id,
            clientName: apptData.clientName,
            clientPhone: null,
            date: apptData.date,
            time: apptData.time,
            notes: apptData.notes || null,
            status: "confirmed",
          });
          apptCreated = true;
        }
      } catch { /* ignore */ }
    }

    if (!apptCreated) {
      try {
        const allHistory = [...history, { role: "user", content: parsed.data.message }];
        const fallbackAppt = await tryFallbackAppointmentExtract(cleanResponse, allHistory);
        if (fallbackAppt) {
          await db.insert(appointmentsTable).values({
            agentId: params.data.id,
            clientName: fallbackAppt.clientName,
            clientPhone: null,
            date: fallbackAppt.date,
            time: fallbackAppt.time,
            notes: fallbackAppt.notes || null,
            status: "confirmed",
          });
          apptCreated = true;
        }
      } catch (err) {
        console.error("[Test] Fallback appointment error:", err);
      }
    }

    if (orderMatch) {
      try {
        const od = JSON.parse(orderMatch[1]) as { clientName?: string; phone?: string; productName?: string; amount?: number };
        if (od.clientName && od.productName && od.amount !== undefined) {
          await db.insert(ordersTable).values({
            userId,
            leadName: od.clientName,
            leadPhone: od.phone || "playground",
            productName: od.productName,
            amount: String(od.amount),
            status: "pending",
          });
          orderCreated = true;
        }
      } catch { /* ignore */ }
    }

    return res.json({ response: cleanResponse, apptCreated, orderCreated });
  } catch (err) {
    console.error("[Test] AI call failed:", err);
    return res.status(502).json({ error: "Impossible de contacter l'IA. Réessayez plus tard." });
  }
});

export default router;
