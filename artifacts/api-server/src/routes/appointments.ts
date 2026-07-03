import { Router, Request } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, agentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

async function getUserAgentIds(userId: number): Promise<number[]> {
  const rows = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.userId, userId));
  return rows.map(r => r.id);
}

const router = Router();

const apptToJson = (a: typeof appointmentsTable.$inferSelect) => ({
  ...a,
  createdAt: a.createdAt.toISOString(),
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentIds = await getUserAgentIds(userId);
  if (agentIds.length === 0) return res.json([]);

  const agentIdFilter = req.query.agentId ? Number(req.query.agentId) : null;

  const rows = agentIdFilter && agentIds.includes(agentIdFilter)
    ? await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.agentId, agentIdFilter), inArray(appointmentsTable.agentId, agentIds)))
        .orderBy(appointmentsTable.date, appointmentsTable.time)
    : await db.select().from(appointmentsTable)
        .where(inArray(appointmentsTable.agentId, agentIds))
        .orderBy(appointmentsTable.date, appointmentsTable.time);

  return res.json(rows.map(apptToJson));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const { agentId, clientName, clientPhone, date, time, notes, status } = req.body as {
    agentId: number; clientName: string; clientPhone?: string;
    date: string; time: string; notes?: string; status?: string;
  };
  if (!agentId || !clientName || !date || !time) {
    return res.status(400).json({ error: "agentId, clientName, date et time sont requis" });
  }
  const ALLOWED_STATUSES = ["confirmed", "cancelled", "pending"];
  const resolvedStatus = ALLOWED_STATUSES.includes(status ?? "") ? status! : "confirmed";
  const agentIds = await getUserAgentIds(userId);
  if (!agentIds.includes(Number(agentId))) {
    return res.status(403).json({ error: "Accès refusé à cet agent" });
  }
  const [appt] = await db.insert(appointmentsTable).values({
    agentId: Number(agentId), userId,
    clientName: String(clientName).slice(0, 200),
    clientPhone: clientPhone ? String(clientPhone).slice(0, 50) : null,
    date: String(date).slice(0, 20), time: String(time).slice(0, 10),
    notes: notes ? String(notes).slice(0, 2000) : null, status: resolvedStatus,
  }).returning();
  return res.status(201).json(apptToJson(appt));
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const agentIds = await getUserAgentIds(userId);
  if (agentIds.length === 0) return res.status(404).json({ error: "Not found" });

  const { clientName, clientPhone, date, time, notes, status } = req.body as {
    clientName?: string; clientPhone?: string; date?: string; time?: string; notes?: string; status?: string;
  };
  const ALLOWED_STATUSES = ["confirmed", "cancelled", "pending"];
  const [appt] = await db.update(appointmentsTable).set({
    ...(clientName !== undefined && { clientName: String(clientName).slice(0, 200) }),
    ...(clientPhone !== undefined && { clientPhone: clientPhone ? String(clientPhone).slice(0, 50) : null }),
    ...(date !== undefined && { date: String(date).slice(0, 20) }),
    ...(time !== undefined && { time: String(time).slice(0, 10) }),
    ...(notes !== undefined && { notes: notes ? String(notes).slice(0, 2000) : null }),
    ...(status !== undefined && ALLOWED_STATUSES.includes(status) && { status }),
  }).where(and(eq(appointmentsTable.id, id), inArray(appointmentsTable.agentId, agentIds))).returning();
  if (!appt) return res.status(404).json({ error: "Not found" });
  return res.json(apptToJson(appt));
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const agentIds = await getUserAgentIds(userId);
  if (agentIds.length === 0) return res.status(404).json({ error: "Not found" });
  await db.delete(appointmentsTable).where(and(eq(appointmentsTable.id, id), inArray(appointmentsTable.agentId, agentIds)));
  return res.status(204).send();
});

router.get("/excel", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentIds = await getUserAgentIds(userId);

  const agentIdFilter = req.query.agentId ? Number(req.query.agentId) : null;

  let rows: { appt: typeof appointmentsTable.$inferSelect; agent: typeof agentsTable.$inferSelect | null }[];

  if (agentIds.length === 0) {
    rows = [];
  } else if (agentIdFilter && agentIds.includes(agentIdFilter)) {
    rows = await db.select({ appt: appointmentsTable, agent: agentsTable })
      .from(appointmentsTable)
      .leftJoin(agentsTable, eq(appointmentsTable.agentId, agentsTable.id))
      .where(and(eq(appointmentsTable.agentId, agentIdFilter), inArray(appointmentsTable.agentId, agentIds)))
      .orderBy(appointmentsTable.date, appointmentsTable.time);
  } else {
    rows = await db.select({ appt: appointmentsTable, agent: agentsTable })
      .from(appointmentsTable)
      .leftJoin(agentsTable, eq(appointmentsTable.agentId, agentsTable.id))
      .where(inArray(appointmentsTable.agentId, agentIds))
      .orderBy(appointmentsTable.date, appointmentsTable.time);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WA Agent";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Rendez-vous");
  sheet.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Agent IA", key: "agent", width: 20 },
    { header: "Nom du client", key: "clientName", width: 25 },
    { header: "Téléphone", key: "clientPhone", width: 18 },
    { header: "Date", key: "date", width: 14 },
    { header: "Heure", key: "time", width: 10 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Statut", key: "status", width: 14 },
    { header: "Créé le", key: "createdAt", width: 20 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF25D366" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 22;

  for (const { appt, agent } of rows) {
    const row = sheet.addRow({
      id: appt.id,
      agent: agent?.name || `Agent #${appt.agentId}`,
      clientName: appt.clientName,
      clientPhone: appt.clientPhone || "",
      date: appt.date,
      time: appt.time,
      notes: appt.notes || "",
      status: appt.status === "confirmed" ? "Confirmé" : appt.status === "cancelled" ? "Annulé" : "En attente",
      createdAt: appt.createdAt.toLocaleString("fr-FR"),
    });

    if (appt.status === "confirmed") {
      row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
      row.getCell("status").font = { color: { argb: "FF065F46" } };
    } else if (appt.status === "cancelled") {
      row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      row.getCell("status").font = { color: { argb: "FF991B1B" } };
    }
  }

  sheet.autoFilter = { from: "A1", to: "I1" };

  const today = new Date().toISOString().slice(0, 10);
  const filename = `rendez-vous-${today}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  return res.end();
});

export default router;
