import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { notificationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const toJson = (n: typeof notificationSettingsTable.$inferSelect) => ({
  ...n,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
});

// ── Zod schema ────────────────────────────────────────────────────────────────
const UpdateNotificationsBody = z.object({
  email:                z.string().email().max(254).optional(),
  frequency:            z.enum(["instant", "hourly", "daily"]).optional(),
  newLead:              z.boolean().optional(),
  newConversation:      z.boolean().optional(),
  agentError:           z.boolean().optional(),
  orderPlaced:          z.boolean().optional(),
  weeklyReport:         z.boolean().optional(),
  dailyDigest:          z.boolean().optional(),
  handoffRequest:       z.boolean().optional(),
  lowCredits:           z.boolean().optional(),
  whatsappDisconnected: z.boolean().optional(),
  newOrder:             z.boolean().optional(),
});

router.get("/", async (req, res) => {
  const userId = (req.session as { userId?: number }).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  let [settings] = await db.select().from(notificationSettingsTable).where(eq(notificationSettingsTable.userId, userId));
  if (!settings) {
    const [created] = await db.insert(notificationSettingsTable).values({ userId }).returning();
    settings = created;
  }
  return res.json(toJson(settings));
});

router.patch("/", async (req, res) => {
  const userId = (req.session as { userId?: number }).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateNotificationsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const d = parsed.data;

  const [existing] = await db.select().from(notificationSettingsTable).where(eq(notificationSettingsTable.userId, userId));

  if (!existing) {
    const [created] = await db.insert(notificationSettingsTable)
      .values({
        userId,
        email:                d.email,
        frequency:            d.frequency             ?? "instant",
        newLead:              d.newLead               ?? true,
        newConversation:      d.newConversation        ?? true,
        agentError:           d.agentError             ?? true,
        orderPlaced:          d.orderPlaced            ?? false,
        weeklyReport:         d.weeklyReport           ?? true,
        dailyDigest:          d.dailyDigest            ?? false,
        handoffRequest:       d.handoffRequest         ?? true,
        lowCredits:           d.lowCredits             ?? true,
        whatsappDisconnected: d.whatsappDisconnected   ?? true,
        newOrder:             d.newOrder               ?? false,
      })
      .returning();
    return res.json(toJson(created));
  }

  const [updated] = await db.update(notificationSettingsTable)
    .set({
      ...(d.email                !== undefined && { email: d.email }),
      ...(d.frequency            !== undefined && { frequency: d.frequency }),
      ...(d.newLead              !== undefined && { newLead: d.newLead }),
      ...(d.newConversation      !== undefined && { newConversation: d.newConversation }),
      ...(d.agentError           !== undefined && { agentError: d.agentError }),
      ...(d.orderPlaced          !== undefined && { orderPlaced: d.orderPlaced }),
      ...(d.weeklyReport         !== undefined && { weeklyReport: d.weeklyReport }),
      ...(d.dailyDigest          !== undefined && { dailyDigest: d.dailyDigest }),
      ...(d.handoffRequest       !== undefined && { handoffRequest: d.handoffRequest }),
      ...(d.lowCredits           !== undefined && { lowCredits: d.lowCredits }),
      ...(d.whatsappDisconnected !== undefined && { whatsappDisconnected: d.whatsappDisconnected }),
      ...(d.newOrder             !== undefined && { newOrder: d.newOrder }),
      updatedAt: new Date(),
    })
    .where(eq(notificationSettingsTable.userId, userId))
    .returning();
  return res.json(toJson(updated));
});

export default router;
