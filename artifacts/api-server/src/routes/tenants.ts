import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { UpdateMyTenantBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tenants/me", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;

  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);

  if (tenants.length === 0) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json(tenants[0]);
});

router.patch("/tenants/me", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const parsed = UpdateMyTenantBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(tenantsTable)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(tenantsTable.id, tenantId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json(updated);
});

export default router;
