import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable, ebaySettingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;

  const [products, keys, orders, settings] = await Promise.all([
    db.select().from(productsTable).where(eq(productsTable.tenantId, tenantId)),
    db.select().from(licenseKeysTable).where(eq(licenseKeysTable.tenantId, tenantId)),
    db.select().from(ordersTable).where(eq(ordersTable.tenantId, tenantId)),
    db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1),
  ]);

  const availableKeys = keys.filter((k) => k.status === "available").length;
  const fulfilledOrders = orders.filter((o) => o.status === "fulfilled").length;
  const failedOrders = orders.filter((o) => o.status === "failed").length;
  const pendingOrders = orders.filter((o) => o.status === "pending").length;
  const s = settings[0];
  const ebayConnected = !!(s?.accessToken);
  const lastSyncAt = s?.lastSyncAt ? s.lastSyncAt.toISOString() : null;

  res.json({
    totalProducts: products.length,
    totalKeys: keys.length,
    availableKeys,
    totalOrders: orders.length,
    fulfilledOrders,
    failedOrders,
    pendingOrders,
    ebayConnected,
    lastSyncAt,
  });
});

router.get("/dashboard/alerts", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const alerts: Array<{
    id: string;
    type: string;
    message: string;
    severity: string;
    productId: number | null;
    orderId: number | null;
    createdAt: string;
  }> = [];

  // Products with no available keys
  const products = await db.select().from(productsTable).where(eq(productsTable.tenantId, tenantId));
  for (const p of products) {
    const availableKeys = await db
      .select()
      .from(licenseKeysTable)
      .where(
        and(
          eq(licenseKeysTable.productId, p.id),
          eq(licenseKeysTable.tenantId, tenantId)
        )
      )
      .then((keys) => keys.filter((k) => k.status === "available"));

    if (availableKeys.length === 0) {
      alerts.push({
        id: `no_keys_${p.id}`,
        type: "no_keys",
        message: `Product "${p.name}" has no available license keys`,
        severity: "error",
        productId: p.id,
        orderId: null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Failed orders
  const failedOrders = await db.select().from(ordersTable).where(
    and(
      eq(ordersTable.status, "failed"),
      eq(ordersTable.tenantId, tenantId)
    )
  );
  for (const o of failedOrders) {
    alerts.push({
      id: `failed_order_${o.id}`,
      type: "failed_order",
      message: `Order #${o.id} for ${o.buyerEmail} failed: ${o.failureReason ?? "Unknown reason"}`,
      severity: "error",
      productId: o.productId,
      orderId: o.id,
      createdAt: o.createdAt.toISOString(),
    });
  }

  res.json(alerts);
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const logs = await db
    .select()
    .from(syncLogsTable)
    .where(eq(syncLogsTable.tenantId, tenantId))
    .orderBy(syncLogsTable.createdAt)
    .limit(20)
    .then((rows) => rows.reverse());

  const activity = logs.map((l) => {
    let type: string = "order_fulfilled";
    if (l.event === "sync_completed") type = "sync_completed";
    else if (l.event === "key_assigned") type = "key_assigned";
    else if (l.event === "no_key_available" || l.event === "key_send_failed") type = "order_failed";

    return {
      id: l.id,
      type,
      message: l.message,
      buyerEmail: null as string | null,
      productName: null as string | null,
      ebayOrderId: l.ebayOrderId ?? null,
      createdAt: l.createdAt.toISOString(),
    };
  });

  res.json(activity);
});

export default router;
