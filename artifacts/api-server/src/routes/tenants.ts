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

  const tenant = tenants[0];
  // Sanitize sensitive fields for display in settings
  // Return masked version of keys if they exist
  const sanitized = {
    ...tenant,
    stripeSecretKey: tenant.stripeSecretKey ? "sk_••••••••" : null,
    stripeWebhookSecret: tenant.stripeWebhookSecret ? "whsec_••••••••" : null,
    resendApiKey: tenant.resendApiKey ? "re_••••••••" : null,
  };

  res.json(sanitized);
});

router.patch("/tenants/me", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const parsed = UpdateMyTenantBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data: any = { ...parsed.data, updatedAt: new Date() };

  // Don't overwrite with masked values
  if (data.stripeSecretKey?.includes("•")) delete data.stripeSecretKey;
  if (data.stripeWebhookSecret?.includes("•")) delete data.stripeWebhookSecret;
  if (data.resendApiKey?.includes("•")) delete data.resendApiKey;

  const [updated] = await db
    .update(tenantsTable)
    .set(data)
    .where(eq(tenantsTable.id, tenantId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json(updated);
});

export default router;
