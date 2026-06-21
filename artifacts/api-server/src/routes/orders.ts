import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ordersTable, productsTable, licenseKeysTable } from "@workspace/db";
import {
  CreateOrderBody,
  ListOrdersQueryParams,
  GetOrderParams,
  FulfillOrderParams,
} from "@workspace/api-zod";
import { fulfillOrderById } from "../lib/ebay-sync";

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
    ebayOrderId: o.ebayOrderId ?? null,
    ebayLineItemId: o.ebayLineItemId ?? null,
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

  // Try to assign a key immediately
  const availableKeys = await db
    .select()
    .from(licenseKeysTable)
    .where(and(eq(licenseKeysTable.productId, parsed.data.productId), eq(licenseKeysTable.status, "available")))
    .limit(1);

  let newOrder;

  if (availableKeys.length > 0) {
    const key = availableKeys[0];
    [newOrder] = await db.insert(ordersTable).values({
      source: "manual",
      status: "fulfilled",
      buyerEmail: parsed.data.buyerEmail,
      buyerName: parsed.data.buyerName,
      productId: parsed.data.productId,
      assignedKeyId: key.id,
      assignedKeyValue: key.keyValue,
      fulfilledAt: new Date(),
    }).returning();

    await db.update(licenseKeysTable).set({
      status: "assigned",
      orderId: newOrder.id,
      assignedAt: new Date(),
    }).where(eq(licenseKeysTable.id, key.id));
  } else {
    [newOrder] = await db.insert(ordersTable).values({
      source: "manual",
      status: "failed",
      buyerEmail: parsed.data.buyerEmail,
      buyerName: parsed.data.buyerName,
      productId: parsed.data.productId,
      failureReason: "No available keys",
    }).returning();
  }

  const formatted = await formatOrder(newOrder);
  res.status(201).json(formatted);
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

  const result = await fulfillOrderById(params.data.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  res.json(await formatOrder(rows[0]));
});

export default router;
