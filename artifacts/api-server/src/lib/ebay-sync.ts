import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable, ebaySettingsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "./logger";

export interface MockEbayOrder {
  ebayOrderId: string;
  ebayLineItemId: string;
  buyerEmail: string;
  buyerName: string;
  sku: string;
  ebayListingId: string;
  quantity: number;
}

export interface SyncResult {
  ordersFound: number;
  ordersProcessed: number;
  keysAssigned: number;
  failed: number;
  skipped: number;
  errors: string[];
}

const MOCK_EBAY_ORDERS: MockEbayOrder[] = [
  {
    ebayOrderId: "MOCK-ORD-001",
    ebayLineItemId: "MOCK-LINE-001",
    buyerEmail: "alice@example.com",
    buyerName: "Alice Johnson",
    sku: "WIN-PRO-2024",
    ebayListingId: "123456789",
    quantity: 1,
  },
  {
    ebayOrderId: "MOCK-ORD-002",
    ebayLineItemId: "MOCK-LINE-002",
    buyerEmail: "bob@example.com",
    buyerName: "Bob Smith",
    sku: "OFFICE-HOME-2024",
    ebayListingId: "987654321",
    quantity: 1,
  },
  {
    ebayOrderId: "MOCK-ORD-003",
    ebayLineItemId: "MOCK-LINE-003",
    buyerEmail: "carol@example.com",
    buyerName: "Carol Williams",
    sku: "WIN-PRO-2024",
    ebayListingId: "123456789",
    quantity: 1,
  },
];

async function logEvent(params: {
  event: string;
  level?: string;
  message: string;
  ebayOrderId?: string;
  orderId?: number;
  productId?: number;
  keyId?: number;
  meta?: Record<string, unknown>;
}) {
  await db.insert(syncLogsTable).values({
    event: params.event,
    level: params.level ?? "info",
    message: params.message,
    ebayOrderId: params.ebayOrderId,
    orderId: params.orderId,
    productId: params.productId,
    keyId: params.keyId,
    meta: params.meta ? JSON.stringify(params.meta) : undefined,
  });
}

async function processOrder(order: {
  ebayOrderId: string;
  ebayLineItemId: string;
  buyerEmail: string;
  buyerName: string;
  sku?: string;
  ebayListingId?: string;
}): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // Check for duplicate
  const existing = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.ebayOrderId, order.ebayOrderId))
    .limit(1);

  if (existing.length > 0) {
    await logEvent({
      event: "duplicate_skipped",
      level: "info",
      message: `Order ${order.ebayOrderId} already processed, skipping`,
      ebayOrderId: order.ebayOrderId,
      orderId: existing[0].id,
    });
    return { success: true, skipped: true };
  }

  // Match product by SKU or listing ID
  let product = null;
  if (order.sku) {
    const rows = await db.select().from(productsTable).where(eq(productsTable.sku, order.sku)).limit(1);
    product = rows[0] ?? null;
  }
  if (!product && order.ebayListingId) {
    const rows = await db.select().from(productsTable).where(eq(productsTable.ebayListingId, order.ebayListingId)).limit(1);
    product = rows[0] ?? null;
  }

  if (!product) {
    const msg = `No product matched for order ${order.ebayOrderId} (SKU: ${order.sku}, listingId: ${order.ebayListingId})`;
    await logEvent({
      event: "order_processed",
      level: "error",
      message: msg,
      ebayOrderId: order.ebayOrderId,
    });
    // Create a failed order record for visibility
    const [newOrder] = await db.insert(ordersTable).values({
      source: "ebay",
      status: "failed",
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      productId: 0 as unknown as number, // no product match
      ebayOrderId: order.ebayOrderId,
      ebayLineItemId: order.ebayLineItemId,
      failureReason: msg,
    }).returning();
    return { success: false, error: msg };
  }

  // Find an available key
  const availableKeys = await db
    .select()
    .from(licenseKeysTable)
    .where(
      and(
        eq(licenseKeysTable.productId, product.id),
        eq(licenseKeysTable.status, "available")
      )
    )
    .limit(1);

  if (availableKeys.length === 0) {
    const msg = `No available keys for product "${product.name}" (order ${order.ebayOrderId})`;
    await logEvent({
      event: "no_key_available",
      level: "error",
      message: msg,
      ebayOrderId: order.ebayOrderId,
      productId: product.id,
    });
    // Create a failed order record
    await db.insert(ordersTable).values({
      source: "ebay",
      status: "failed",
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      productId: product.id,
      ebayOrderId: order.ebayOrderId,
      ebayLineItemId: order.ebayLineItemId,
      failureReason: msg,
    });
    return { success: false, error: msg };
  }

  const key = availableKeys[0];

  // Create the order
  const [newOrder] = await db.insert(ordersTable).values({
    source: "ebay",
    status: "fulfilled",
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
    productId: product.id,
    ebayOrderId: order.ebayOrderId,
    ebayLineItemId: order.ebayLineItemId,
    assignedKeyId: key.id,
    assignedKeyValue: key.keyValue,
    fulfilledAt: new Date(),
  }).returning();

  // Mark the key as assigned
  await db
    .update(licenseKeysTable)
    .set({
      status: "assigned",
      orderId: newOrder.id,
      assignedAt: new Date(),
    })
    .where(eq(licenseKeysTable.id, key.id));

  await logEvent({
    event: "key_assigned",
    level: "info",
    message: `Key assigned to buyer ${order.buyerEmail} for product "${product.name}"`,
    ebayOrderId: order.ebayOrderId,
    orderId: newOrder.id,
    productId: product.id,
    keyId: key.id,
  });

  // In production, send email here. For now, log the "send"
  logger.info({ buyerEmail: order.buyerEmail, keyValue: key.keyValue }, "Key delivery logged (email would be sent here)");
  await logEvent({
    event: "order_processed",
    level: "info",
    message: `Order fulfilled for ${order.buyerEmail} — key sent`,
    ebayOrderId: order.ebayOrderId,
    orderId: newOrder.id,
    productId: product.id,
    keyId: key.id,
  });

  return { success: true };
}

export async function runMockSync(): Promise<SyncResult> {
  logger.info("Starting mock eBay sync");
  await logEvent({ event: "sync_started", level: "info", message: "Mock eBay sync started" });

  const result: SyncResult = {
    ordersFound: MOCK_EBAY_ORDERS.length,
    ordersProcessed: 0,
    keysAssigned: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const mockOrder of MOCK_EBAY_ORDERS) {
    try {
      const res = await processOrder(mockOrder);
      if (res.skipped) {
        result.skipped++;
      } else if (res.success) {
        result.ordersProcessed++;
        result.keysAssigned++;
      } else {
        result.failed++;
        if (res.error) result.errors.push(res.error);
      }
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      logger.error({ err }, "Failed to process mock order");
    }
  }

  await logEvent({
    event: "sync_completed",
    level: "info",
    message: `Mock sync complete: ${result.keysAssigned} keys assigned, ${result.failed} failed, ${result.skipped} skipped`,
    meta: result as unknown as Record<string, unknown>,
  });

  // Update last sync time in settings
  const settings = await db.select().from(ebaySettingsTable).limit(1);
  if (settings.length > 0) {
    await db.update(ebaySettingsTable).set({ lastSyncAt: new Date() }).where(eq(ebaySettingsTable.id, settings[0].id));
  } else {
    await db.insert(ebaySettingsTable).values({ lastSyncAt: new Date() });
  }

  return result;
}

export async function runRealEbaySync(): Promise<SyncResult> {
  const settings = await db.select().from(ebaySettingsTable).limit(1);
  if (settings.length === 0 || !settings[0].accessToken) {
    throw new Error("eBay account not connected. Please connect your eBay account first.");
  }

  const s = settings[0];

  // Check if token is expired
  if (s.tokenExpiresAt && s.tokenExpiresAt < new Date()) {
    throw new Error("eBay access token has expired. Please reconnect your eBay account.");
  }

  logger.info("Starting real eBay sync");
  await logEvent({ event: "sync_started", level: "info", message: "Real eBay sync started" });

  const result: SyncResult = {
    ordersFound: 0,
    ordersProcessed: 0,
    keysAssigned: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Fetch orders from eBay Sell Fulfillment API
  // Only orders with PAID checkout status, last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filter = `lastmodifieddate:[${thirtyDaysAgo.toISOString()}..] and orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`;

  const response = await fetch(
    `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200`,
    {
      headers: {
        Authorization: `Bearer ${s.accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay API error ${response.status}: ${text}`);
  }

  const data = await response.json() as { orders?: Array<Record<string, unknown>>, total?: number };
  const orders = data.orders ?? [];
  result.ordersFound = data.total ?? orders.length;

  for (const ebayOrder of orders) {
    const lineItems = (ebayOrder.lineItems as Array<Record<string, unknown>>) ?? [];
    for (const lineItem of lineItems) {
      try {
        const buyerEmail = (ebayOrder.buyer as Record<string, string>)?.username ?? "";
        const ebayOrderId = ebayOrder.orderId as string;
        const ebayLineItemId = lineItem.lineItemId as string;
        const sku = lineItem.sku as string | undefined;
        const listingId = (lineItem.listingMarketplaceId ?? lineItem.legacyItemId) as string | undefined;

        const res = await processOrder({
          ebayOrderId,
          ebayLineItemId,
          buyerEmail,
          buyerName: "",
          sku,
          ebayListingId: listingId,
        });

        if (res.skipped) {
          result.skipped++;
        } else if (res.success) {
          result.ordersProcessed++;
          result.keysAssigned++;
        } else {
          result.failed++;
          if (res.error) result.errors.push(res.error);
        }
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(msg);
        logger.error({ err }, "Failed to process eBay order line item");
      }
    }
  }

  await logEvent({
    event: "sync_completed",
    level: "info",
    message: `Real sync complete: ${result.keysAssigned} keys assigned, ${result.failed} failed, ${result.skipped} skipped`,
    meta: result as unknown as Record<string, unknown>,
  });

  // Update last sync time
  await db.update(ebaySettingsTable).set({ lastSyncAt: new Date() }).where(eq(ebaySettingsTable.id, s.id));

  return result;
}

export async function fulfillOrderById(orderId: number): Promise<{ success: boolean; error?: string }> {
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (orders.length === 0) {
    return { success: false, error: "Order not found" };
  }
  const order = orders[0];
  if (order.status === "fulfilled") {
    return { success: true };
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.id, order.productId)).limit(1);
  if (products.length === 0) {
    return { success: false, error: "Product not found" };
  }
  const product = products[0];

  const availableKeys = await db
    .select()
    .from(licenseKeysTable)
    .where(and(eq(licenseKeysTable.productId, product.id), eq(licenseKeysTable.status, "available")))
    .limit(1);

  if (availableKeys.length === 0) {
    await db.update(ordersTable).set({ failureReason: "No available keys", status: "failed" }).where(eq(ordersTable.id, orderId));
    return { success: false, error: "No available keys for this product" };
  }

  const key = availableKeys[0];

  await db.update(ordersTable).set({
    status: "fulfilled",
    assignedKeyId: key.id,
    assignedKeyValue: key.keyValue,
    failureReason: null,
    fulfilledAt: new Date(),
  }).where(eq(ordersTable.id, orderId));

  await db.update(licenseKeysTable).set({
    status: "assigned",
    orderId,
    assignedAt: new Date(),
  }).where(eq(licenseKeysTable.id, key.id));

  await logEvent({
    event: "key_assigned",
    level: "info",
    message: `Manual fulfillment: Key assigned for order ${orderId} to ${order.buyerEmail}`,
    orderId,
    productId: product.id,
    keyId: key.id,
  });

  return { success: true };
}
