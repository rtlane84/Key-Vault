import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ordersTable, productsTable, licenseKeysTable } from "@workspace/db";
import {
  CreateOrderBody,
  ListOrdersQueryParams,
  GetOrderParams,
  FulfillOrderParams,
  ResendOrderEmailParams,
} from "@workspace/api-zod";
import { fulfillOrder } from "../lib/fulfillment";
import { sendLicenseEmail } from "../lib/email";

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

router.get("/orders", async (req, res): Promise<void> => {
  const params = ListOrdersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(ordersTable).$dynamic();
  const conditions = [];

  if (params.data.status) conditions.push(eq(ordersTable.status, params.data.status));
  if (params.data.source) conditions.push(eq(ordersTable.source, params.data.source));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const orders = await query.orderBy(ordersTable.createdAt);
  const formatted = await Promise.all(orders.map(formatOrder));
  res.json(formatted);
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.id, parsed.data.productId)).limit(1);
  if (products.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Create pending order
  const [newOrder] = await db.insert(ordersTable).values({
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
    productId: parsed.data.productId,
    buyerEmail: parsed.data.buyerEmail,
    buyerName: parsed.data.buyerName,
  });

  if (!result.success) {
    await db.update(ordersTable).set({ status: "failed", failureReason: result.error }).where(eq(ordersTable.id, newOrder.id));
  }

  const final = await db.select().from(ordersTable).where(eq(ordersTable.id, newOrder.id)).limit(1);
  res.status(201).json(await formatOrder(final[0]));
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetOrderParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(await formatOrder(rows[0]));
});

router.post("/orders/:id/fulfill", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = FulfillOrderParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const order = rows[0];
  const result = await fulfillOrder({
    orderId: order.id,
    productId: order.productId,
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
  });

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const updated = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  res.json(await formatOrder(updated[0]));
});

router.post("/orders/:id/resend-email", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ResendOrderEmailParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const order = rows[0];
  if (!order.assignedKeyValue) {
    res.status(400).json({ error: "Order has no assigned key to send" });
    return;
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.id, order.productId)).limit(1);
  const product = products[0];

  const result = await sendLicenseEmail({
    to: order.buyerEmail,
    buyerName: order.buyerName,
    productName: product?.name ?? "Your product",
    keyValue: order.assignedKeyValue,
    orderId: order.id,
    purchaseDate: order.fulfilledAt ?? order.createdAt,
    emailTemplate: product?.emailTemplate,
  });

  res.json({ success: result.success, error: result.error ?? null });
});

export default router;
