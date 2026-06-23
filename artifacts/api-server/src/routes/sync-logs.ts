import { Router, type IRouter } from "express";
import { db, syncLogsTable } from "@workspace/db";
import { ListSyncLogsQueryParams } from "@workspace/api-zod";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/sync-logs", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const params = ListSyncLogsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 50;

  const logs = await db
    .select()
    .from(syncLogsTable)
    .where(eq(syncLogsTable.tenantId, tenantId))
    .orderBy(desc(syncLogsTable.createdAt))
    .limit(limit);

  res.json(
    logs.map((l) => ({
      id: l.id,
      event: l.event,
      level: l.level,
      ebayOrderId: l.ebayOrderId ?? null,
      orderId: l.orderId ?? null,
      productId: l.productId ?? null,
      keyId: l.keyId ?? null,
      message: l.message,
      meta: l.meta ?? null,
      createdAt: l.createdAt.toISOString(),
    }))
  );
});

export default router;
