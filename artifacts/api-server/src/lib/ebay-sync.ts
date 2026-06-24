import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable, ebaySettingsTable, ebayListingsTable, ebaySyncHistoryTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import { fulfillOrder } from "./fulfillment";
import { getEbayConfig } from "./ebay-config";

const ebayConfig = getEbayConfig();

export async function refreshEbayToken(tenantId: number): Promise<string> {
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  if (settings.length === 0 || !settings[0].refreshToken) {
    throw new Error("eBay account not connected or refresh token missing.");
  }

  const s = settings[0];
  
  // If token is still valid for more than 5 minutes, return it
  if (s.accessToken && s.tokenExpiresAt && s.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return s.accessToken;
  }

  if (ebayConfig.isMockMode) {
    throw new Error("eBay credentials not configured (EBAY_CLIENT_ID/EBAY_CLIENT_SECRET)");
  }

  logger.info({ tenantId, env: ebayConfig.env }, "Refreshing eBay access token...");
  const credentials = Buffer.from(`${ebayConfig.clientId}:${ebayConfig.clientSecret}`).toString("base64");
  
  const response = await fetch(`${ebayConfig.apiBase}/identity/v1/oauth2/token`, {
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
    logger.error({ status: response.status, body: text, tenantId }, "eBay token refresh failed");
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
  listingsSynced: number;
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
  tenantId: number;
  ebayOrderId?: string;
  orderId?: number;
  productId?: number;
  keyId?: number;
  meta?: Record<string, unknown>;
}) {
  await db.insert(syncLogsTable).values({
    tenantId: params.tenantId,
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
  tenantId: number;
  sku?: string;
  ebayListingId?: string;
  quantity?: number;
}): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // Check for duplicate by ebayOrderId AND ebayLineItemId to handle multi-item orders correctly
  const existing = await db
    .select()
    .from(ordersTable)
    .where(and(
      eq(ordersTable.ebayOrderId, order.ebayOrderId),
      eq(ordersTable.ebayLineItemId, order.ebayLineItemId),
      eq(ordersTable.tenantId, order.tenantId)
    ))
    .limit(1);

  if (existing.length > 0) {
    // If it exists, try fulfilling it if it's not fulfilled yet
    if (existing[0].status !== "fulfilled") {
      const res = await fulfillOrder({ orderId: existing[0].id });
      return { success: res.success, error: res.error };
    }
    
    await logEvent({
      tenantId: existing[0].tenantId,
      event: "duplicate_skipped",
      level: "info",
      message: `eBay Order ${order.ebayOrderId} Line ${order.ebayLineItemId} already processed, skipping`,
      ebayOrderId: order.ebayOrderId,
      orderId: existing[0].id,
    });
    return { success: true, skipped: true };
  }

  // Match product by SKU or listing ID
  let product = null;
  
  // 1. Try matching by listing ID via ebayListingsTable
  if (order.ebayListingId) {
    const rows = await db.select().from(ebayListingsTable).where(
      and(
        eq(ebayListingsTable.listingId, order.ebayListingId),
        eq(ebayListingsTable.tenantId, order.tenantId)
      )
    ).limit(1);
    if (rows[0]?.productId) {
      const pRows = await db.select().from(productsTable).where(
        and(
          eq(productsTable.id, rows[0].productId),
          eq(productsTable.tenantId, order.tenantId)
        )
      ).limit(1);
      product = pRows[0] ?? null;
    }
  }

  // 2. Try matching by SKU directly
  if (!product && order.sku) {
    const rows = await db.select().from(productsTable).where(
      and(
        eq(productsTable.sku, order.sku),
        eq(productsTable.tenantId, order.tenantId)
      )
    ).limit(1);
    product = rows[0] ?? null;
  }

  if (!product) {
    const msg = `No product matched for eBay order ${order.ebayOrderId} (SKU: ${order.sku}, listingId: ${order.ebayListingId})`;
    logger.warn({ ebayOrderId: order.ebayOrderId, sku: order.sku, listingId: order.ebayListingId, tenantId: order.tenantId }, "Product match failed");
    await logEvent({
      tenantId: order.tenantId,
      event: "product_match_failed",
      level: "error",
      message: msg,
      ebayOrderId: order.ebayOrderId,
    });
    return { success: false, error: msg };
  }

  const quantity = order.quantity || 1;

  if (!order.buyerEmail || !order.buyerEmail.includes("@")) {
    const msg = `eBay order ${order.ebayOrderId} has no usable buyer email (${order.buyerEmail})`;
    await logEvent({
      tenantId: order.tenantId,
      event: "missing_email",
      level: "error",
      message: msg,
      ebayOrderId: order.ebayOrderId,
    });
    // Create the order record but mark as failed/needs attention
    await db.insert(ordersTable).values({
      tenantId: order.tenantId,
      source: "ebay",
      status: "failed",
      buyerEmail: order.buyerEmail || "no-email@ebay.com",
      buyerName: order.buyerName,
      ebayBuyerUsername: order.buyerName,
      productId: product.id,
      quantity,
      ebayOrderId: order.ebayOrderId,
      ebayLineItemId: order.ebayLineItemId,
      failureReason: "missing_or_invalid_buyer_email",
    });
    return { success: false, error: "missing_buyer_email" };
  }

  // Create the order record in a pending state
  const [newOrder] = await db.insert(ordersTable).values({
    tenantId: order.tenantId,
    source: "ebay",
    status: "pending",
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
    ebayBuyerUsername: order.buyerName,
    productId: product.id,
    quantity,
    ebayOrderId: order.ebayOrderId,
    ebayLineItemId: order.ebayLineItemId,
  }).returning();

  logger.info({ 
    ebayOrderId: order.ebayOrderId, 
    buyerEmail: order.buyerEmail, 
    product: product.name, 
    quantity 
  }, "Processing eBay order");

  // Fulfill the order
  const fulfillmentResult = await fulfillOrder({
    orderId: newOrder.id,
  });

  if (!fulfillmentResult.success) {
    return { success: false, error: fulfillmentResult.error };
  }

  return { success: true };
}

export async function runMockSync(tenantId: number): Promise<SyncResult> {
  logger.info({ tenantId }, "Starting mock eBay sync");
  await logEvent({ tenantId, event: "sync_started", level: "info", message: "Mock eBay sync started" });

  const result: SyncResult = {
    ordersFound: MOCK_EBAY_ORDERS.length,
    ordersProcessed: 0,
    keysAssigned: 0,
    listingsSynced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const mockOrder of MOCK_EBAY_ORDERS) {
    try {
      const res = await processOrder({ ...mockOrder, tenantId });
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
      logger.error({ err, tenantId }, "Failed to process mock order");
    }
  }

  await logEvent({
    tenantId,
    event: "sync_completed",
    level: "info",
    message: `Mock sync complete: ${result.keysAssigned} keys assigned, ${result.failed} failed, ${result.skipped} skipped`,
    meta: result as unknown as Record<string, unknown>,
  });

  // Update last sync time in settings
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  if (settings.length > 0) {
    await db.update(ebaySettingsTable).set({ lastSyncAt: new Date() }).where(eq(ebaySettingsTable.id, settings[0].id));
  } else {
    await db.insert(ebaySettingsTable).values({ tenantId, lastSyncAt: new Date() });
  }

  return result;
}

export async function runRealEbaySync(tenantId: number): Promise<SyncResult> {
  const accessToken = await refreshEbayToken(tenantId);

  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  const s = settings[0];

  logger.info({ tenantId }, "Starting real eBay sync");
  await logEvent({ tenantId, event: "sync_started", level: "info", message: "Real eBay sync started" });

  const result: SyncResult = {
    ordersFound: 0,
    ordersProcessed: 0,
    keysAssigned: 0,
    listingsSynced: 0,
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
            const buyerUsername = (ebayOrder.buyer as Record<string, any>)?.username || "";
            let buyerEmail = (ebayOrder.buyer as Record<string, any>)?.email || "";
            
            if (!buyerEmail || buyerEmail === "") {
              logger.warn({ ebayOrderId: ebayOrder.orderId, buyerUsername, tenantId }, "eBay order missing buyer email");
            }

            const ebayOrderId = ebayOrder.orderId as string;
            const ebayLineItemId = lineItem.lineItemId as string;
            const sku = lineItem.sku as string | undefined;
            const listingId = (lineItem.legacyItemId || lineItem.listingMarketplaceId) as string | undefined;
            const quantity = parseInt(lineItem.quantity as string || "1", 10);

            const res = await processOrder({
              ebayOrderId,
              ebayLineItemId,
              buyerEmail,
              buyerName: buyerUsername,
              sku,
              ebayListingId: listingId,
              quantity,
              tenantId,
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
            logger.error({ err, tenantId }, "Failed to process eBay order line item");
          }
        }
      }
    } else {
      const text = await response.text();
      logger.error({ status: response.status, text, tenantId }, "eBay Order API error");
      result.errors.push(`Order API error: ${response.status}`);
    }
  } catch (err) {
    logger.error({ err, tenantId }, "eBay Order sync failed");
    result.errors.push("Order sync failed");
  }

  // 2. Sync Listings (Inventory API)
  try {
    const listingsResult = await syncEbayListings(accessToken, tenantId);
    result.listingsSynced = listingsResult.total;
    
    // 2.1 Push inventory levels to eBay
    await pushInventoryToEbay(tenantId).catch(err => {
      logger.error({ err, tenantId }, "Inventory push failed during sync");
      result.errors.push("Inventory push failed");
    });
  } catch (err) {
    logger.error({ err }, "eBay Listing sync failed");
    result.errors.push("Listing sync failed");
  }

  await logEvent({
    tenantId,
    event: "sync_completed",
    level: "info",
    message: `Real sync complete: ${result.keysAssigned} keys assigned, ${result.failed} failed, ${result.skipped} skipped`,
    meta: result as unknown as Record<string, unknown>,
  });

  // Update last sync time
  await db.update(ebaySettingsTable).set({ lastSyncAt: new Date() }).where(
    and(
      eq(ebaySettingsTable.id, s.id),
      eq(ebaySettingsTable.tenantId, tenantId)
    )
  );

  // 3. Record Sync History
  await db.insert(ebaySyncHistoryTable).values({
    tenantId,
    type: "orders",
    status: result.failed > 0 ? "partial" : "success",
    ordersFound: result.ordersFound,
    ordersProcessed: result.ordersProcessed,
    keysAssigned: result.keysAssigned,
    listingsSynced: result.listingsSynced,
    failedCount: result.failed,
    errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
  });

  return result;
}

export async function syncEbayListings(accessToken: string, tenantId: number): Promise<{ imported: number, updated: number, total: number }> {
  logger.info({ tenantId }, "Real eBay listing sync started (using Inventory API)");

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
          .where(
            and(
              eq(ebayListingsTable.listingId, listingId),
              eq(ebayListingsTable.tenantId, tenantId)
            )
          ).limit(1);

        // Auto-map by SKU
        const matchedProducts = await db.select().from(productsTable)
          .where(
            and(
              eq(productsTable.sku, sku),
              eq(productsTable.tenantId, tenantId)
            )
          ).limit(1);
        const productId = matchedProducts[0]?.id ?? null;

        const listingData = {
          tenantId,
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
          await db.update(ebayListingsTable).set(listingData).where(
            and(
              eq(ebayListingsTable.listingId, listingId),
              eq(ebayListingsTable.tenantId, tenantId)
            )
          );
          updated++;
        }
      }
    }
  }

  return { imported, updated, total: items.length };
}

/**
 * Pushes local license key stock levels to eBay listings.
 */
export async function pushInventoryToEbay(tenantId: number): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  try {
    const accessToken = await refreshEbayToken(tenantId);
    
    // 1. Get all mapped eBay listings for this tenant
    const listings = await db.select().from(ebayListingsTable)
      .where(
        and(
          eq(ebayListingsTable.tenantId, tenantId),
          isNotNull(ebayListingsTable.productId)
        )
      );

    for (const listing of listings) {
      if (!listing.productId || !listing.sku) continue;

      // 2. Count available keys for the product
      const availableKeys = await db.select().from(licenseKeysTable)
        .where(
          and(
            eq(licenseKeysTable.productId, listing.productId),
            eq(licenseKeysTable.status, "available"),
            eq(licenseKeysTable.tenantId, tenantId)
          )
        );
      
      const count = availableKeys.length;

      // 3. Update eBay inventory item
      // We use the Inventory API bulkUpdateInventoryItem or updateInventoryItem
      const response = await fetch(`${ebayConfig.apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(listing.sku)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify({
          availability: {
            shipToLocationAvailability: {
              quantity: count,
            },
          },
        }),
      });

      if (response.ok) {
        // 4. Update local listing cache
        await db.update(ebayListingsTable)
          .set({ quantity: count, lastSyncAt: new Date() })
          .where(eq(ebayListingsTable.id, listing.id));
        updated++;
      } else {
        const text = await response.text();
        logger.error({ sku: listing.sku, status: response.status, error: text }, "Failed to push inventory to eBay");
        failed++;
      }
    }
  } catch (err) {
    logger.error({ err, tenantId }, "Error pushing inventory to eBay");
    throw err;
  }

  return { updated, failed };
}

/**
 * Mark an order as fulfilled (shipped) on eBay.
 * For digital goods, we omit tracking info.
 */
export async function markOrderAsFulfilledOnEbay(ebayOrderId: string, orderId: number, tenantId: number): Promise<{ success: boolean; fulfillmentId?: string }> {
  try {
    const accessToken = await refreshEbayToken(tenantId);
    
    logger.info({ ebayOrderId, orderId }, "Marking eBay order as fulfilled...");

    const response = await fetch(
      `${ebayConfig.apiBase}/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lineItems: [], // Empty array means fulfill all line items in the order
        }),
      }
    );

    if (response.ok || response.status === 201) {
      const data = await response.json() as { fulfillmentId: string };
      const fulfillmentId = data.fulfillmentId;

      logger.info({ ebayOrderId, fulfillmentId }, "eBay order successfully marked as fulfilled");
      await logEvent({
        tenantId,
        event: "ebay_marked_fulfilled",
        level: "info",
        message: `eBay order marked as fulfilled. ID: ${fulfillmentId}`,
        ebayOrderId,
        orderId,
      });
      return { success: true, fulfillmentId };
    } else if (response.status === 409) {
      logger.info({ ebayOrderId }, "eBay order already marked as fulfilled (409 Conflict)");
      return { success: true };
    } else {
      const errorText = await response.text();
      logger.error({ ebayOrderId, status: response.status, error: errorText }, "Failed to mark eBay order fulfilled");
      await logEvent({
        tenantId,
        event: "ebay_fulfillment_failed",
        level: "error",
        message: `Failed to mark eBay fulfilled: ${response.status} ${errorText}`,
        ebayOrderId,
        orderId,
      });
      return { success: false };
    }
  } catch (err) {
    logger.error({ err, ebayOrderId }, "Error calling eBay Fulfillment API");
    await logEvent({
      tenantId,
      event: "ebay_fulfillment_failed",
      level: "error",
      message: `Error marking eBay fulfilled: ${err instanceof Error ? err.message : String(err)}`,
      ebayOrderId,
      orderId,
    });
    return { success: false };
  }
}

export async function fulfillOrderById(orderId: number): Promise<{ success: boolean; error?: string }> {
  return fulfillOrder({ orderId });
}
