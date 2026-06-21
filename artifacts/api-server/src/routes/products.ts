import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, productsTable, licenseKeysTable } from "@workspace/db";
import {
  CreateProductBody,
  UpdateProductBody,
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/products", async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable).orderBy(productsTable.name);

  const withCounts = await Promise.all(
    products.map(async (p) => {
      const allKeys = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.productId, p.id));
      const availableKeyCount = allKeys.filter((k) => k.status === "available").length;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        ebayListingId: p.ebayListingId ?? null,
        description: p.description ?? null,
        availableKeyCount,
        totalKeyCount: allKeys.length,
        createdAt: p.createdAt.toISOString(),
      };
    })
  );

  res.json(withCounts);
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .insert(productsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json({
    id: product.id,
    name: product.name,
    sku: product.sku,
    ebayListingId: product.ebayListingId ?? null,
    description: product.description ?? null,
    availableKeyCount: 0,
    totalKeyCount: 0,
    createdAt: product.createdAt.toISOString(),
  });
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const p = rows[0];
  const allKeys = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.productId, p.id));
  const availableKeyCount = allKeys.filter((k) => k.status === "available").length;

  res.json({
    id: p.id,
    name: p.name,
    sku: p.sku,
    ebayListingId: p.ebayListingId ?? null,
    description: p.description ?? null,
    availableKeyCount,
    totalKeyCount: allKeys.length,
    createdAt: p.createdAt.toISOString(),
  });
});

router.patch("/products/:id", async (req, res): Promise<void> => {
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
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const p = rows[0];
  const allKeys = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.productId, p.id));
  const availableKeyCount = allKeys.filter((k) => k.status === "available").length;

  res.json({
    id: p.id,
    name: p.name,
    sku: p.sku,
    ebayListingId: p.ebayListingId ?? null,
    description: p.description ?? null,
    availableKeyCount,
    totalKeyCount: allKeys.length,
    createdAt: p.createdAt.toISOString(),
  });
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.delete(productsTable).where(eq(productsTable.id, params.data.id)).returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
