import { Router, type IRouter } from "express";
import { eq, isNotNull, isNull, and } from "drizzle-orm";
import { db, ebayListingsTable, productsTable } from "@workspace/db";
import { runRealEbaySync } from "../lib/ebay-sync";
import {
  ListEbayListingsQueryParams,
  MapEbayListingParams,
  MapEbayListingBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getEbayConfig } from "../lib/ebay-config";

const router: IRouter = Router();
const ebayConfig = getEbayConfig();

async function formatListing(l: typeof ebayListingsTable.$inferSelect) {
  let productName: string | null = null;
  if (l.productId) {
    const p = await db.select().from(productsTable).where(
      and(
        eq(productsTable.id, l.productId),
        eq(productsTable.tenantId, l.tenantId)
      )
    ).limit(1);
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

router.get("/", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const params = ListEbayListingsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(ebayListingsTable).where(eq(ebayListingsTable.tenantId, tenantId)).$dynamic();

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
router.post("/sync", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;

  if (ebayConfig.isMockMode) {
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
        .where(
          and(
            eq(ebayListingsTable.listingId, mock.listingId),
            eq(ebayListingsTable.tenantId, tenantId)
          )
        ).limit(1);

      // Auto-map by SKU if possible
      let productId: number | null = null;
      if (mock.sku) {
        const matchedProducts = await db.select().from(productsTable)
          .where(
            and(
              eq(productsTable.sku, mock.sku),
              eq(productsTable.tenantId, tenantId)
            )
          ).limit(1);
        productId = matchedProducts[0]?.id ?? null;
      }

      if (existing.length === 0) {
        await db.insert(ebayListingsTable).values({
          tenantId,
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
        }).where(
          and(
            eq(ebayListingsTable.listingId, mock.listingId),
            eq(ebayListingsTable.tenantId, tenantId)
          )
        );
        updated++;
      }
    }

    res.json({ imported, updated, total: mockListings.length });
    return;
  }

  // Real eBay listings sync via Inventory API
  try {
    const { refreshEbayToken, syncEbayListings } = await import("../lib/ebay-sync");
    const accessToken = await refreshEbayToken(tenantId);
    const result = await syncEbayListings(accessToken, tenantId);
    res.json(result);
  } catch (err) {
    logger.error({ err, tenantId }, "Real eBay listing sync failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

router.patch("/:id/map", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
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
    .where(
      and(
        eq(ebayListingsTable.id, params.data.id),
        eq(ebayListingsTable.tenantId, tenantId)
      )
    )
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  res.json(await formatListing(rows[0]));
});

export default router;
