import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable, ebaySettingsTable, ebayListingsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { fulfillOrder } from "./fulfillment";

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID ?? "";
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET ?? "";
const EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI ?? "";

export async function refreshEbayToken(): Promise<string> {
  const settings = await db.select().from(ebaySettingsTable).limit(1);
  if (settings.length === 0 || !settings[0].refreshToken) {
    throw new Error("eBay account not connected or refresh token missing.");
  }

  const s = settings[0];
  
  // If token is still valid for more than 5 minutes, return it
  if (s.accessToken && s.tokenExpiresAt && s.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return s.accessToken;
  }

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    throw new Error("eBay credentials not configured (EBAY_CLIENT_ID/EBAY_CLIENT_SECRET)");
  }

  logger.info("Refreshing eBay access token...");
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: s.refreshToken || "",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text }, "eBay token refresh failed");
    throw new Error(`eBay token refresh failed: ${response.status}`);
  }

  const tokens = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db.update(ebaySettingsTable).set({
    accessToken: tokens.access_token,
    tokenExpiresAt: expiresAt,
  }).where(eq(ebaySettingsTable.id, s.id));

  return tokens.access_token;
}

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
  
  // 1. Try matching by listing ID via ebayListingsTable (preferred for manual mapping)
  if (order.ebayListingId) {
    const rows = await db.select().from(ebayListingsTable).where(eq(ebayListingsTable.listingId, order.ebayListingId)).limit(1);
    if (rows[0]?.productId) {
      const pRows = await db.select().from(productsTable).where(eq(productsTable.id, rows[0].productId)).limit(1);
      product = pRows[0] ?? null;
    }
  }

  // 2. Try matching by SKU directly in productsTable
  if (!product && order.sku) {
    const rows = await db.select().from(productsTable).where(eq(productsTable.sku, order.sku)).limit(1);
    product = rows[0] ?? null;
  }

  // 3. Try matching by Listing ID directly in productsTable (legacy support)
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
  const fulfillmentResult = await fulfillOrder({
    orderId: newOrder.id,
    productId: product.id,
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
  });

  if (!fulfillmentResult.success) {
    await logEvent({
      event: "fulfillment_failed",
      level: "error",
      message: `Fulfillment failed for order ${order.ebayOrderId}: ${fulfillmentResult.error}`,
      ebayOrderId: order.ebayOrderId,
      orderId: newOrder.id,
    });
    return { success: false, error: fulfillmentResult.error };
  }

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
  const accessToken = await refreshEbayToken();

  const settings = await db.select().from(ebaySettingsTable).limit(1);
  const s = settings[0];

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

  // 1. Sync Orders
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filter = `lastmodifieddate:[${thirtyDaysAgo.toISOString()}..] and orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`;

    const response = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const data = await response.json() as { orders?: Array<Record<string, unknown>>, total?: number };
      const orders = data.orders ?? [];
      result.ordersFound = data.total ?? orders.length;

      for (const ebayOrder of orders) {
        const lineItems = (ebayOrder.lineItems as Array<Record<string, unknown>>) ?? [];
        for (const lineItem of lineItems) {
          try {
            const buyerEmail = (ebayOrder.buyer as Record<string, string>)?.email || (ebayOrder.buyer as Record<string, string>)?.username || "";
            const buyerName = (ebayOrder.buyer as Record<string, string>)?.username || "";
            const ebayOrderId = ebayOrder.orderId as string;
            const ebayLineItemId = lineItem.lineItemId as string;
            const sku = lineItem.sku as string | undefined;
            const listingId = (lineItem.legacyItemId || lineItem.listingMarketplaceId) as string | undefined;

            const res = await processOrder({
              ebayOrderId,
              ebayLineItemId,
              buyerEmail,
              buyerName,
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
    } else {
      const text = await response.text();
      logger.error({ status: response.status, text }, "eBay Order API error");
      result.errors.push(`Order API error: ${response.status}`);
    }
  } catch (err) {
    logger.error({ err }, "eBay Order sync failed");
    result.errors.push("Order sync failed");
  }

  // 2. Sync Listings (Inventory API)
  try {
    await syncEbayListings(accessToken);
  } catch (err) {
    logger.error({ err }, "eBay Listing sync failed");
    result.errors.push("Listing sync failed");
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

export async function syncEbayListings(accessToken: string): Promise<{ imported: number, updated: number, total: number }> {
  logger.info("Real eBay listing sync started (using Inventory API)");

  const response = await fetch("https://api.ebay.com/sell/inventory/v1/inventory_item?limit=100&offset=0", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay Inventory API error ${response.status}: ${text}`);
  }

  const data = await response.json() as { inventoryItems?: any[] };
  const items = data.inventoryItems ?? [];

  let imported = 0;
  let updated = 0;

  for (const item of items) {
    const sku = item.sku;
    const offerResponse = await fetch(`https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (offerResponse.ok) {
      const offerData = await offerResponse.json() as { offers?: any[] };
      const offers = offerData.offers ?? [];
      for (const offer of offers) {
        if (!offer.listingId) continue;

        const listingId = offer.listingId;
        const existing = await db.select().from(ebayListingsTable)
          .where(eq(ebayListingsTable.listingId, listingId)).limit(1);

        // Auto-map by SKU
        const matchedProducts = await db.select().from(productsTable)
          .where(eq(productsTable.sku, sku)).limit(1);
        const productId = matchedProducts[0]?.id ?? null;

        const listingData = {
          listingId,
          title: item.product?.title || "Unknown Title",
          sku,
          price: offer.price?.value ? Math.round(parseFloat(offer.price.value) * 100) : 0,
          quantity: item.availability?.shipToLocationAvailability?.quantity ?? 0,
          status: offer.status === "PUBLISHED" ? "active" : "ended",
          productId: existing[0]?.productId ?? productId,
          lastSyncAt: new Date(),
        };

        if (existing.length === 0) {
          await db.insert(ebayListingsTable).values(listingData);
          imported++;
        } else {
          await db.update(ebayListingsTable).set(listingData).where(eq(ebayListingsTable.listingId, listingId));
          updated++;
        }
      }
    }
  }

  return { imported, updated, total: items.length };
}

/**
 * Mark an order as fulfilled (shipped) on eBay.
 * For digital goods, we omit tracking info.
 */
export async function markOrderAsFulfilledOnEbay(ebayOrderId: string, orderId: number): Promise<boolean> {
  try {
    const accessToken = await refreshEbayToken();
    
    logger.info({ ebayOrderId, orderId }, "Marking eBay order as fulfilled...");

    const response = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lineItems: [], // Empty array means fulfill all line items in the order
          // For digital delivery, we don't provide trackingNumber or shippingCarrierCode
        }),
      }
    );

    if (response.ok || response.status === 409) {
      // 409 Conflict usually means it's already fulfilled
      const statusMessage = response.status === 409 
        ? "eBay order already marked as fulfilled (409)" 
        : "eBay order successfully marked as fulfilled";
      
      logger.info({ ebayOrderId, status: response.status }, statusMessage);
      await logEvent({
        event: "ebay_marked_fulfilled",
        level: "info",
        message: statusMessage,
        ebayOrderId,
        orderId,
      });
      return true;
    } else {
      const errorText = await response.text();
      logger.error({ ebayOrderId, status: response.status, error: errorText }, "Failed to mark eBay order fulfilled");
      await logEvent({
        event: "ebay_fulfillment_failed",
        level: "error",
        message: `Failed to mark eBay fulfilled: ${response.status} ${errorText}`,
        ebayOrderId,
        orderId,
      });
      return false;
    }
  } catch (err) {
    logger.error({ err, ebayOrderId }, "Error calling eBay Fulfillment API");
    await logEvent({
      event: "ebay_fulfillment_failed",
      level: "error",
      message: `Error marking eBay fulfilled: ${err instanceof Error ? err.message : String(err)}`,
      ebayOrderId,
      orderId,
    });
    return false;
  }
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

  // If it's an eBay order, mark it as fulfilled on eBay
  if (order.source === "ebay" && order.ebayOrderId) {
    await markOrderAsFulfilledOnEbay(order.ebayOrderId, orderId);
  }

  return { success: true };
}
