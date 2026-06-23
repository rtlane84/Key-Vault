import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ordersTable, productsTable, licenseKeysTable, syncLogsTable, tenantsTable } from "@workspace/db";
import {
  CreateOrderBody,
  ListOrdersQueryParams,
  GetOrderParams,
  FulfillOrderParams,
  ResendOrderEmailParams,
} from "@workspace/api-zod";
import { fulfillOrder } from "../lib/fulfillment";
import { sendLicenseEmail } from "../lib/email";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

async function formatOrder(o: typeof ordersTable.$inferSelect) {
  let productName: string | null = null;
  if (o.productId) {
    const p = await db.select().from(productsTable).where(eq(productsTable.id, o.productId)).limit(1);
    productName = p[0]?.name ?? null;
  }

  return {
    id: o.id,
    source: o.source,
    status: o.status,
    buyerEmail: o.buyerEmail,
    buyerName: o.buyerName ?? null,
    productId: o.productId,
    productName,
    quantity: o.quantity,
    ebayOrderId: o.ebayOrderId ?? null,
    ebayLineItemId: o.ebayLineItemId ?? null,
    stripePaymentIntentId: o.stripePaymentIntentId ?? null,
    stripeSessionId: o.stripeSessionId ?? null,
    assignedKeyId: o.assignedKeyId ?? null,
    assignedKeyValue: o.assignedKeyValue ?? null,
    failureReason: o.failureReason ?? null,
    fulfilledAt: o.fulfilledAt ? o.fulfilledAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/orders/lookup", async (req, res): Promise<void> => {
  const { email, reference } = req.query;
  if (!email || !reference) {
    res.status(400).json({ error: "Email and reference are required" });
    return;
  }

  // Find all orders for this email
  const results = await db.select().from(ordersTable).where(
    eq(ordersTable.buyerEmail, email as string)
  );

  const found = results.find(o => 
    String(o.id) === reference || 
    o.stripeSessionId === reference || 
    o.ebayOrderId === reference
  );

  if (!found) {
    res.status(404).json({ error: "Order not found with provided email and reference" });
    return;
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.id, found.productId)).limit(1);
  const product = products[0];

  const keys = found.keys ? (JSON.parse(found.keys) as string[]) : (found.assignedKeyValue ? [found.assignedKeyValue] : null);

  res.json({
    status: found.status,
    productName: product?.name ?? "Unknown Product",
    quantity: found.quantity,
    keys: found.status === 'fulfilled' ? keys : null,
    activationInstructions: product?.activationInstructions ?? null,
    fulfilledAt: found.fulfilledAt ? found.fulfilledAt.toISOString() : null,
    createdAt: found.createdAt.toISOString(),
  });
});

router.use((req, res, next) => {
  // We only want to skip auth for the lookup route
  if (req.path === "/orders/lookup") {
    return next();
  }
  return requireAuth(req, res, next);
});

router.get("/orders", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const params = ListOrdersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(ordersTable).$dynamic();
  const conditions = [eq(ordersTable.tenantId, tenantId)];

  if (params.data.status) conditions.push(eq(ordersTable.status, params.data.status));
  if (params.data.source) conditions.push(eq(ordersTable.source, params.data.source));
  query = query.where(and(...conditions));

  const orders = await query.orderBy(ordersTable.createdAt);
  const formatted = await Promise.all(orders.map(formatOrder));
  res.json(formatted);
});

router.post("/orders", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const products = await db.select().from(productsTable).where(
    and(
      eq(productsTable.id, parsed.data.productId),
      eq(productsTable.tenantId, tenantId)
    )
  ).limit(1);
  if (products.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Create pending order
  const [newOrder] = await db.insert(ordersTable).values({
    tenantId,
    source: "manual",
    status: "pending",
    buyerEmail: parsed.data.buyerEmail,
    buyerName: parsed.data.buyerName,
    productId: parsed.data.productId,
    quantity: 1,
  }).returning();

  // Fulfill immediately
  const result = await fulfillOrder({
    orderId: newOrder.id,
  });

  if (!result.success) {
    await db.update(ordersTable).set({ status: "failed", failureReason: result.error }).where(eq(ordersTable.id, newOrder.id));
  }

  const final = await db.select().from(ordersTable).where(eq(ordersTable.id, newOrder.id)).limit(1);
  res.status(201).json(await formatOrder(final[0]));
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetOrderParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.id, params.data.id),
      eq(ordersTable.tenantId, tenantId)
    )
  ).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(await formatOrder(rows[0]));
});

router.post("/orders/:id/fulfill", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = FulfillOrderParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.id, params.data.id),
      eq(ordersTable.tenantId, tenantId)
    )
  ).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const order = rows[0];
  const result = await fulfillOrder({
    orderId: order.id,
  });

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const updated = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.id, params.data.id),
      eq(ordersTable.tenantId, tenantId)
    )
  ).limit(1);
  res.json(await formatOrder(updated[0]));
});

router.post("/orders/:id/resend-email", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ResendOrderEmailParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.id, params.data.id),
      eq(ordersTable.tenantId, tenantId)
    )
  ).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const order = rows[0];
  const keysToResend = order.keys ? (JSON.parse(order.keys) as string[]).join("\n") : order.assignedKeyValue;

  if (!keysToResend) {
    res.status(400).json({ error: "Order has no assigned keys to send" });
    return;
  }

  const products = await db.select().from(productsTable).where(
    and(
      eq(productsTable.id, order.productId),
      eq(productsTable.tenantId, tenantId)
    )
  ).limit(1);
  const product = products[0];

  // Resolve tenant settings for email
  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const tenant = tenants[0];

  const result = await sendLicenseEmail({
    to: order.buyerEmail,
    buyerName: order.buyerName,
    productName: product?.name ?? "Your product",
    keyValue: keysToResend,
    orderId: order.id,
    purchaseDate: order.fulfilledAt ?? order.createdAt,
    activationInstructions: product?.activationInstructions,
    emailTemplate: product?.emailTemplate,
    // SaaS
    resendApiKey: tenant?.resendApiKey,
    fromEmail: tenant?.fromEmail,
    appName: tenant?.name,
  });

  if (result.success) {
    await db.insert(syncLogsTable).values({
      tenantId,
      event: "resend_email_success",
      level: "info",
      message: result.error === "SIMULATED" 
        ? `Resent license email for order #${order.id} (SIMULATED)`
        : `Resent license email for order #${order.id} to ${order.buyerEmail}`,
      orderId: order.id,
      productId: order.productId,
    });
  } else {
    await db.insert(syncLogsTable).values({
      tenantId,
      event: "resend_email_failed",
      level: "error",
      message: `Failed to resend license email for order #${order.id}: ${result.error}`,
      orderId: order.id,
      productId: order.productId,
    });
  }

  res.json({ success: result.success, error: result.error ?? null });
});

router.get("/orders/lookup", async (req, res): Promise<void> => {
  const { email, reference } = req.query;
  if (!email || !reference) {
    res.status(400).json({ error: "Email and reference are required" });
    return;
  }

  // Find order where email matches AND (id = reference OR stripeSessionId = reference OR ebayOrderId = reference)
  // To avoid SQL injection and type issues, we handle id carefully
  let orderId: number | undefined = undefined;
  if (/^\d+$/.test(reference as string)) {
    orderId = parseInt(reference as string, 10);
  }

  let query = db.select().from(ordersTable).where(eq(ordersTable.buyerEmail, email as string)).$dynamic();

  const conditions = [];
  if (orderId !== undefined) conditions.push(eq(ordersTable.id, orderId));
  conditions.push(eq(ordersTable.stripeSessionId, reference as string));
  conditions.push(eq(ordersTable.ebayOrderId, reference as string));

  const rows = await query.where(and(
    eq(ordersTable.buyerEmail, email as string),
    // Use or for the references
    // drizzle or condition
  )).limit(1);
  
  // Refined query for lookup
  const results = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.buyerEmail, email as string),
      // We need to match one of the reference fields
      // Using a manual approach for simplicity since it's just one row
    )
  );

  const found = results.find(o => 
    String(o.id) === reference || 
    o.stripeSessionId === reference || 
    o.ebayOrderId === reference
  );

  if (!found) {
    res.status(404).json({ error: "Order not found with provided email and reference" });
    return;
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.id, found.productId)).limit(1);
  const product = products[0];

  const keys = found.keys ? (JSON.parse(found.keys) as string[]) : (found.assignedKeyValue ? [found.assignedKeyValue] : null);

  res.json({
    status: found.status,
    productName: product?.name ?? "Unknown Product",
    quantity: found.quantity,
    keys: found.status === 'fulfilled' ? keys : null,
    activationInstructions: product?.activationInstructions ?? null,
    fulfilledAt: found.fulfilledAt ? found.fulfilledAt.toISOString() : null,
    createdAt: found.createdAt.toISOString(),
  });
});

export default router;
