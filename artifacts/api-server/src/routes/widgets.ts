import { Router, Request } from "express";
import { db } from "@workspace/db";
import { widgetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateWidgetBody, UpdateWidgetParams, UpdateWidgetBody, DeleteWidgetParams } from "@workspace/api-zod";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

/** Escape HTML attribute values to prevent XSS in the generated embed snippet */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const genEmbed = (phone: string, welcome: string, color: string, text: string, pos: string) =>
  `<script src="https://wa-agent.app/widget.js" data-phone="${escapeHtmlAttr(phone)}" data-welcome="${escapeHtmlAttr(welcome)}" data-color="${escapeHtmlAttr(color)}" data-text="${escapeHtmlAttr(text)}" data-position="${escapeHtmlAttr(pos)}"></script>`;

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const widgets = await db.select().from(widgetsTable)
    .where(eq(widgetsTable.userId, userId))
    .orderBy(widgetsTable.createdAt);
  return res.json(widgets.map(w => ({ ...w, createdAt: w.createdAt.toISOString() })));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const parsed = CreateWidgetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const embedCode = genEmbed(parsed.data.phoneNumber, parsed.data.welcomeText, parsed.data.buttonColor, parsed.data.buttonText ?? "Chat with us", parsed.data.position ?? "bottom-right");
  const [widget] = await db.insert(widgetsTable).values({
    userId,
    name: parsed.data.name,
    phoneNumber: parsed.data.phoneNumber,
    welcomeText: parsed.data.welcomeText,
    buttonColor: parsed.data.buttonColor,
    buttonText: parsed.data.buttonText,
    position: parsed.data.position ?? "bottom-right",
    embedCode,
  }).returning();
  return res.status(201).json({ ...widget, createdAt: widget.createdAt.toISOString() });
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = UpdateWidgetParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateWidgetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [widget] = await db.update(widgetsTable).set({
    ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    ...(parsed.data.phoneNumber !== undefined && { phoneNumber: parsed.data.phoneNumber }),
    ...(parsed.data.welcomeText !== undefined && { welcomeText: parsed.data.welcomeText }),
    ...(parsed.data.buttonColor !== undefined && { buttonColor: parsed.data.buttonColor }),
    ...(parsed.data.buttonText !== undefined && { buttonText: parsed.data.buttonText }),
    ...(parsed.data.position !== undefined && { position: parsed.data.position }),
    ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
  }).where(and(eq(widgetsTable.id, params.data.id), eq(widgetsTable.userId, userId))).returning();
  if (!widget) return res.status(404).json({ error: "Not found" });
  return res.json({ ...widget, createdAt: widget.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = DeleteWidgetParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(widgetsTable).where(and(eq(widgetsTable.id, params.data.id), eq(widgetsTable.userId, userId)));
  return res.status(204).send();
});

export default router;
