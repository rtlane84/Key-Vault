import { Router, type IRouter } from "express";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { db, ebayListingsTable, productsTable } from "@workspace/db";
import { runRealEbaySync } from "../lib/ebay-sync";
import {
  ListEbayListingsQueryParams,
  MapEbayListingParams,
  MapEbayListingBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function formatListing(l: typeof ebayListingsTable.$inferSelect) {
  let productName: string | null = null;
  if (l.productId) {
    const p = await db.select().from(productsTable).where(eq(productsTable.id, l.productId)).limit(1);
    productName = p[0]?.name ?? null;
  }
  return {
    id: l.id,
    listingId: l.listingId,
    title: l.title,
    sku: l.sku ?? null,
    price: l.price ?? null,
    quantity: l.quantity,
    status: l.status,
    productId: l.productId ?? null,
    productName,
    lastSyncAt: l.lastSyncAt ? l.lastSyncAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

router.get("/ebay/listings", async (req, res): Promise<void> => {
  const params = ListEbayListingsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(ebayListingsTable).$dynamic();

  if (params.data.mapped === true) {
    query = query.where(isNotNull(ebayListingsTable.productId));
  } else if (params.data.mapped === false) {
    query = query.where(isNull(ebayListingsTable.productId));
  }

  const listings = await query.orderBy(ebayListingsTable.createdAt);
  const formatted = await Promise.all(listings.map(formatListing));
  res.json(formatted);
});

// Sync listings from eBay or create mock listings
router.post("/ebay/listings/sync", async (req, res): Promise<void> => {
  const ebayClientId = process.env.EBAY_CLIENT_ID;

  if (!ebayClientId) {
    // Mock mode: create some demo listings
    const mockListings = [
      { listingId: "MOCK-LIST-001", title: "Windows 11 Pro License Key", sku: "WIN-PRO-2024", price: 2999, quantity: 50 },
      { listingId: "MOCK-LIST-002", title: "Microsoft Office Home 2024", sku: "OFFICE-HOME-2024", price: 4999, quantity: 30 },
      { listingId: "MOCK-LIST-003", title: "Windows 11 Home License Key", sku: "WIN-HOME-2024", price: 1999, quantity: 20 },
    ];

    let imported = 0;
    let updated = 0;

    for (const mock of mockListings) {
      const existing = await db.select().from(ebayListingsTable)
        .where(eq(ebayListingsTable.listingId, mock.listingId)).limit(1);

      // Auto-map by SKU if possible
      let productId: number | null = null;
      if (mock.sku) {
        const matchedProducts = await db.select().from(productsTable)
          .where(eq(productsTable.sku, mock.sku)).limit(1);
        productId = matchedProducts[0]?.id ?? null;
      }

      if (existing.length === 0) {
        await db.insert(ebayListingsTable).values({
          listingId: mock.listingId,
          title: mock.title,
          sku: mock.sku,
          price: mock.price,
          quantity: mock.quantity,
          status: "active",
          productId,
          lastSyncAt: new Date(),
        });
        imported++;
      } else {
        await db.update(ebayListingsTable).set({
          title: mock.title,
          sku: mock.sku,
          price: mock.price,
          quantity: mock.quantity,
          productId: existing[0].productId ?? productId,
          lastSyncAt: new Date(),
        }).where(eq(ebayListingsTable.listingId, mock.listingId));
        updated++;
      }
    }

    res.json({ imported, updated, total: mockListings.length });
    return;
  }

  // Real eBay listings sync via Inventory API
  try {
    const result = await runRealEbaySync();
    // runRealEbaySync now returns both order sync results AND listing sync results if we want,
    // but I added the listing sync at the end of it.
    // Wait, I should probably have made a separate function for listings.
    // Let me check what I did.
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Real eBay listing sync failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

router.patch("/ebay/listings/:id/map", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = MapEbayListingParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = MapEbayListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .update(ebayListingsTable)
    .set({ productId: parsed.data.productId })
    .where(eq(ebayListingsTable.id, params.data.id))
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  res.json(await formatListing(rows[0]));
});

export default router;
