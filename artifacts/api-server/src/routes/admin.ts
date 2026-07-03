import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, agentsTable, conversationsTable, messagesTable, leadsTable, ordersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();

// Admin middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = req.session as { userId?: number; userRole?: string };
  if (!session.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  if (session.userRole !== "admin") {
    return res.status(403).json({ error: "Accès refusé — administrateur requis" });
  }
  return next();
}

router.use(requireAdmin);

// GET /api/admin/users
router.get("/users", async (_req, res) => {
  const users = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);
  return res.json(users);
});

// PATCH /api/admin/users/:id/role
router.patch("/users/:id/role", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) return res.status(400).json({ error: "ID invalide" });
  const { role } = req.body as { role?: string };
  if (!role || !["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "Rôle invalide (admin ou user)" });
  }
  const [user] = await db.update(usersTable).set({ role }).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) return res.status(400).json({ error: "ID invalide" });
  const session = req.session as { userId?: number };
  if (session.userId === id) {
    return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  return res.json({ ok: true });
});

// GET /api/admin/stats
router.get("/stats", async (_req, res) => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [agentCount] = await db.select({ count: count() }).from(agentsTable);
  const [convCount] = await db.select({ count: count() }).from(conversationsTable);
  const [msgCount] = await db.select({ count: count() }).from(messagesTable);
  const [leadCount] = await db.select({ count: count() }).from(leadsTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  return res.json({
    users: userCount?.count ?? 0,
    agents: agentCount?.count ?? 0,
    conversations: convCount?.count ?? 0,
    messages: msgCount?.count ?? 0,
    leads: leadCount?.count ?? 0,
    orders: orderCount?.count ?? 0,
  });
});

// GET /api/admin/agents — all agents with owner info
router.get("/agents", async (_req, res) => {
  const rows = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      model: agentsTable.model,
      isActive: agentsTable.isActive,
      whatsappConnected: agentsTable.whatsappConnected,
      whatsappPhone: agentsTable.whatsappPhone,
      createdAt: agentsTable.createdAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(agentsTable)
    .leftJoin(usersTable, eq(agentsTable.userId, usersTable.id))
    .orderBy(agentsTable.createdAt);

  return res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  })));
});

export default router;
