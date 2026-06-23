import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, productsTable, licenseKeysTable } from "@workspace/db";
import {
  CreateProductBody,
  UpdateProductBody,
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function formatProduct(p: typeof productsTable.$inferSelect) {
  const allKeys = await db.select().from(licenseKeysTable).where(
    and(
      eq(licenseKeysTable.productId, p.id),
      eq(licenseKeysTable.tenantId, p.tenantId)
    )
  );
  const availableKeyCount = allKeys.filter((k) => k.status === "available").length;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.description ?? null,
    shortDescription: p.shortDescription ?? null,
    price: p.price,
    imageUrl: p.imageUrl ?? null,
    category: p.category ?? null,
    active: p.active,
    stripeProductId: p.stripeProductId ?? null,
    stripePriceId: p.stripePriceId ?? null,
    ebayListingId: p.ebayListingId ?? null,
    activationInstructions: p.activationInstructions ?? null,
    emailTemplate: p.emailTemplate ?? null,
    lowInventoryThreshold: p.lowInventoryThreshold,
    availableKeyCount,
    totalKeyCount: allKeys.length,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const products = await db.select().from(productsTable).where(eq(productsTable.tenantId, tenantId)).orderBy(productsTable.name);
  const result = await Promise.all(products.map(formatProduct));
  res.json(result);
});

router.post("/products", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db.insert(productsTable).values({
    ...parsed.data,
    tenantId,
  }).returning();
  res.status(201).json(await formatProduct(product));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(productsTable).where(
    and(
      eq(productsTable.id, params.data.id),
      eq(productsTable.tenantId, tenantId)
    )
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(await formatProduct(rows[0]));
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .update(productsTable)
    .set(parsed.data)
    .where(
      and(
        eq(productsTable.id, params.data.id),
        eq(productsTable.tenantId, tenantId)
      )
    )
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(await formatProduct(rows[0]));
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.delete(productsTable).where(
    and(
      eq(productsTable.id, params.data.id),
      eq(productsTable.tenantId, tenantId)
    )
  ).returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
