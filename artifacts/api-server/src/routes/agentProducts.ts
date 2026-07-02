import { Router, Request } from "express";
import { db } from "@workspace/db";
import { agentProductsTable, productsTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

// GET /agents/:agentId/products — get products assigned to an agent
router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentId = Number((req.params as { agentId?: string }).agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return res.status(400).json({ error: "Invalid agentId" });

  if (!(await assertAgentOwnership(agentId, userId))) {
    return res.status(403).json({ error: "Interdit" });
  }

  const rows = await db
    .select({ product: productsTable })
    .from(agentProductsTable)
    .innerJoin(productsTable, eq(agentProductsTable.productId, productsTable.id))
    .where(and(eq(agentProductsTable.agentId, agentId), eq(productsTable.userId, userId)));

  return res.json(rows.map(r => ({
    ...r.product,
    price: Number(r.product.price),
    createdAt: r.product.createdAt.toISOString(),
  })));
});

// PUT /agents/:agentId/products — set agent's products (full replace)
router.put("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const agentId = Number((req.params as { agentId?: string }).agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return res.status(400).json({ error: "Invalid agentId" });

  if (!(await assertAgentOwnership(agentId, userId))) {
    return res.status(403).json({ error: "Interdit" });
  }

  const { productIds } = req.body as { productIds: unknown };
  if (!Array.isArray(productIds) || !productIds.every(id => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: "productIds must be an array of positive integers" });
  }

  // Verify all product IDs belong to the user to prevent cross-user product injection
  if (productIds.length > 0) {
    const userProducts = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.userId, userId));
    const userProductIds = new Set(userProducts.map(p => p.id));
    const invalid = (productIds as number[]).filter(id => !userProductIds.has(id));
    if (invalid.length > 0) {
      return res.status(403).json({ error: "Certains produits ne vous appartiennent pas" });
    }
  }

  await db.delete(agentProductsTable).where(eq(agentProductsTable.agentId, agentId));

  if ((productIds as number[]).length > 0) {
    await db.insert(agentProductsTable).values(
      (productIds as number[]).map(productId => ({ agentId, productId })),
    );
  }

  return res.json({ agentId, productIds });
});

export default router;
