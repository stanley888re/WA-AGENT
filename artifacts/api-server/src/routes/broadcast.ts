import { Router, Request } from "express";
import { db } from "@workspace/db";
import { agentsTable, leadsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { waManager } from "../services/whatsapp.js";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const DELAY_MS = 1200; // delay between messages to avoid WA rate limiting

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function phoneToJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{prénom\}\}/gi, vars.name ?? "")
    .replace(/\{\{nom\}\}/gi, vars.name ?? "")
    .replace(/\{\{numéro\}\}/gi, vars.phone ?? "")
    .replace(/\{\{phone\}\}/gi, vars.phone ?? "")
    .replace(/\{\{email\}\}/gi, vars.email ?? "");
}

const router = Router();

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });

  const { agentId, message, leadIds } = req.body;

  if (typeof agentId !== "number" || !Number.isInteger(agentId) || agentId <= 0)
    return res.status(400).json({ error: "agentId invalide" });
  if (typeof message !== "string" || message.trim().length === 0 || message.length > 4096)
    return res.status(400).json({ error: "message invalide" });
  if (!Array.isArray(leadIds) || leadIds.length === 0 || leadIds.length > 500
      || !leadIds.every(id => typeof id === "number" && Number.isInteger(id) && id > 0))
    return res.status(400).json({ error: "leadIds invalide" });

  // Verify agent belongs to user and is connected
  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
  if (!agent) return res.status(404).json({ error: "Agent introuvable" });
  if (!agent.whatsappConnected) return res.status(400).json({ error: "Cet agent n'est pas connecté à WhatsApp" });

  // Fetch leads
  const leads = await db.select().from(leadsTable)
    .where(and(inArray(leadsTable.id, leadIds), eq(leadsTable.userId, userId)));

  if (leads.length === 0) return res.status(400).json({ error: "Aucun contact valide trouvé" });

  const results: { leadId: number; name: string; phone: string; status: "sent" | "failed"; error?: string }[] = [];

  for (const lead of leads) {
    const text = interpolate(message, {
      name: lead.name,
      phone: lead.phone ?? "",
      email: lead.email ?? "",
    });

    const jid = phoneToJid(lead.phone);

    try {
      const ok = await waManager.sendMessageToJid(agentId, jid, text);
      results.push({ leadId: lead.id, name: lead.name, phone: lead.phone, status: ok ? "sent" : "failed" });
    } catch (err) {
      // Log internally but never expose raw error details to the client
      console.error(`[Broadcast] Failed to send to lead ${lead.id} (${lead.phone}):`, err);
      results.push({ leadId: lead.id, name: lead.name, phone: lead.phone, status: "failed", error: "Échec d'envoi" });
    }

    // throttle — skip delay after last message
    if (lead !== leads[leads.length - 1]) {
      await sleep(DELAY_MS);
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status === "failed").length;

  return res.json({ sent, failed, total: results.length, results });
});

export default router;
