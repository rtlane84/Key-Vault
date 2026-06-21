import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, licenseKeysTable } from "@workspace/db";
import {
  CreateKeyBody,
  ImportKeysBody,
  DeleteKeyParams,
  ListKeysQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatKey(k: typeof licenseKeysTable.$inferSelect) {
  return {
    id: k.id,
    productId: k.productId,
    keyValue: k.keyValue,
    status: k.status,
    orderId: k.orderId ?? null,
    assignedAt: k.assignedAt ? k.assignedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  };
}

router.get("/keys", async (req, res): Promise<void> => {
  const params = ListKeysQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(licenseKeysTable).$dynamic();

  const conditions = [];
  if (params.data.productId !== undefined) {
    conditions.push(eq(licenseKeysTable.productId, params.data.productId));
  }
  if (params.data.status) {
    conditions.push(eq(licenseKeysTable.status, params.data.status));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const keys = await query.orderBy(licenseKeysTable.createdAt);
  res.json(keys.map(formatKey));
});

router.post("/keys", async (req, res): Promise<void> => {
  const parsed = CreateKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [key] = await db
    .insert(licenseKeysTable)
    .values({
      productId: parsed.data.productId,
      keyValue: parsed.data.keyValue,
      status: "available",
    })
    .returning();

  res.status(201).json(formatKey(key));
});

router.post("/keys/import", async (req, res): Promise<void> => {
  const parsed = ImportKeysBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { productId, keys } = parsed.data;
  let imported = 0;
  let skipped = 0;

  for (const keyValue of keys) {
    if (!keyValue.trim()) { skipped++; continue; }
    // Check for duplicate
    const existing = await db
      .select()
      .from(licenseKeysTable)
      .where(and(eq(licenseKeysTable.productId, productId), eq(licenseKeysTable.keyValue, keyValue.trim())))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(licenseKeysTable).values({
      productId,
      keyValue: keyValue.trim(),
      status: "available",
    });
    imported++;
  }

  res.json({ imported, skipped, total: keys.length });
});

router.delete("/keys/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteKeyParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db.delete(licenseKeysTable).where(eq(licenseKeysTable.id, params.data.id)).returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Key not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
