import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { UpdateMyTenantBody } from "@workspace/api-zod";
import { sendLicenseEmail } from "../lib/email";
import { logger } from "../lib/logger";

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

router.post("/tenants/verify-resend", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;

  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);

  if (tenants.length === 0) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const tenant = tenants[0];

  if (!tenant.resendApiKey) {
    res.status(400).json({ success: false, message: "Resend API key not configured" });
    return;
  }

  if (!tenant.fromEmail) {
    res.status(400).json({ success: false, message: "From Email not configured" });
    return;
  }

  const testEmail = tenant.supportEmail || process.env.ADMIN_EMAIL;

  if (!testEmail) {
    res.status(400).json({ success: false, message: "Support email not configured for test" });
    return;
  }

  logger.info({ tenantId, to: testEmail }, "Verifying Resend connection");

  const result = await sendLicenseEmail({
    to: testEmail,
    buyerName: "Verification Test",
    productName: "Resend Verification",
    keyValue: "TEST-KEY-12345",
    orderId: 0,
    purchaseDate: new Date(),
    resendApiKey: tenant.resendApiKey,
    fromEmail: tenant.fromEmail,
    appName: tenant.name,
  });

  if (result.success) {
    res.json({ success: true, message: `Test email sent to ${testEmail}` });
  } else {
    res.status(400).json({ success: false, message: result.error || "Failed to send test email" });
  }
});

export default router;
