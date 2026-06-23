import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, productsTable, licenseKeysTable, tenantsTable } from "@workspace/db";

const router: IRouter = Router();

function formatPublic(p: typeof productsTable.$inferSelect, availableKeyCount: number) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? null,
    shortDescription: p.shortDescription ?? null,
    price: p.price,
    imageUrl: p.imageUrl ?? null,
    category: p.category ?? null,
    stripePriceId: p.stripePriceId ?? null,
    activationInstructions: p.activationInstructions ?? null,
    availableKeyCount,
  };
}

router.get("/public/tenants/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const rows = await db.select().from(tenantsTable).where(eq(tenantsTable.slug, slug)).limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const t = rows[0];
  res.json({
    id: t.id,
    name: t.name,
    slug: t.slug,
    supportEmail: t.supportEmail ?? null,
  });
});

router.get("/public/tenants/:slug/products", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.slug, slug)).limit(1);

  if (tenants.length === 0) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const tenantId = tenants[0].id;

  const products = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.active, true), eq(productsTable.tenantId, tenantId)))
    .orderBy(productsTable.name);

  const result = await Promise.all(
    products.map(async (p) => {
      const keys = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.productId, p.id));
      const availableKeyCount = keys.filter((k) => k.status === "available").length;
      return formatPublic(p, availableKeyCount);
    })
  );

  res.json(result);
});

router.get("/products/public", async (_req, res): Promise<void> => {
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.active, true))
    .orderBy(productsTable.name);

  const result = await Promise.all(
    products.map(async (p) => {
      const keys = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.productId, p.id));
      const availableKeyCount = keys.filter((k) => k.status === "available").length;
      return formatPublic(p, availableKeyCount);
    })
  );

  res.json(result);
});

router.get("/products/:slug/by-slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;

  const rows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.slug, slug))
    .limit(1);

  if (rows.length === 0 || !rows[0].active) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const p = rows[0];
  const keys = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.productId, p.id));
  const availableKeyCount = keys.filter((k) => k.status === "available").length;

  res.json(formatPublic(p, availableKeyCount));
});

export default router;
