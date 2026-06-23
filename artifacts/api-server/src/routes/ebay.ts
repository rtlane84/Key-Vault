import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ebaySettingsTable, syncLogsTable } from "@workspace/db";
import { runMockSync, runRealEbaySync } from "../lib/ebay-sync";
import { logger } from "../lib/logger";
import { UpdateEbayPollSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID ?? "";
const EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI ?? "";
const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

router.get("/ebay/status", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  const mockMode = !EBAY_CLIENT_ID;

  if (settings.length === 0 || !settings[0].accessToken) {
    res.json({
      connected: false,
      mockMode,
      sellerId: null,
      tokenExpiresAt: null,
      lastSyncAt: null,
    });
    return;
  }

  const s = settings[0];
  res.json({
    connected: true,
    mockMode,
    sellerId: s.sellerId ?? null,
    tokenExpiresAt: s.tokenExpiresAt ? s.tokenExpiresAt.toISOString() : null,
    lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
  });
});

router.get("/ebay/connect", async (req, res): Promise<void> => {
  if (!EBAY_CLIENT_ID) {
    res.json({ url: "#mock-mode-no-ebay-credentials" });
    return;
  }

  const tenantId = (req as any).tenantId;
  const state = `tenant_${tenantId}_${Math.random().toString(36).slice(2)}`;
  const url = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(EBAY_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(EBAY_REDIRECT_URI)}&scope=${encodeURIComponent(EBAY_SCOPES)}&state=${state}`;
  res.json({ url });
});

// OAuth callback — called by eBay, redirects to frontend
router.get("/ebay/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  if (error || !code) {
    logger.warn({ error, query: req.query }, "eBay OAuth callback error");
    res.redirect("/?ebay_error=1");
    return;
  }

  if (!EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    res.redirect("/?ebay_error=missing_credentials");
    return;
  }

  try {
    const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: EBAY_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      logger.error({ status: tokenRes.status, body: text }, "eBay token exchange failed");
      res.redirect("/?ebay_error=token_exchange_failed");
      return;
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_token_expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    let sellerId: string | undefined;
    try {
      const identityRes = await fetch("https://api.ebay.com/commerce/identity/v1/user/", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (identityRes.ok) {
        const identity = await identityRes.json() as { username?: string };
        sellerId = identity.username;
      }
    } catch {
      logger.warn("Could not fetch eBay seller identity");
    }

    // Extract tenantId from state
    const stateStr = req.query.state as string | undefined;
    const tenantIdMatch = stateStr?.match(/^tenant_(\d+)_/);
    const tenantId = tenantIdMatch ? parseInt(tenantIdMatch[1], 10) : null;

    if (!tenantId) {
      logger.error({ state: req.query.state }, "eBay callback missing tenantId in state");
      res.redirect("/?ebay_error=missing_tenant");
      return;
    }

    const existing = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
    if (existing.length > 0) {
      await db.update(ebaySettingsTable).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        sellerId,
      }).where(eq(ebaySettingsTable.id, existing[0].id));
    } else {
      await db.insert(ebaySettingsTable).values({
        tenantId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        sellerId,
      });
    }

    await db.insert(syncLogsTable).values({
      tenantId,
      event: "oauth_connected",
      level: "info",
      message: `eBay account connected${sellerId ? ` (seller: ${sellerId})` : ""}`,
    });

    res.redirect("/ebay?connected=1");
  } catch (err) {
    logger.error({ err }, "eBay OAuth callback failed");
    res.redirect("/?ebay_error=unknown");
  }
});

router.post("/ebay/disconnect", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  if (settings.length > 0) {
    await db.update(ebaySettingsTable).set({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      sellerId: null,
    }).where(eq(ebaySettingsTable.id, settings[0].id));
  }

  await db.insert(syncLogsTable).values({
    tenantId,
    event: "oauth_disconnected",
    level: "info",
    message: "eBay account disconnected",
  });

  res.json({ connected: false, mockMode: !EBAY_CLIENT_ID, sellerId: null, tokenExpiresAt: null, lastSyncAt: null });
});

router.post("/ebay/sync", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  try {
    const result = await runRealEbaySync(tenantId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    req.log.error({ err }, "eBay sync failed");
    res.status(400).json({ error: message });
  }
});

router.post("/ebay/mock-sync", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  try {
    const result = await runMockSync(tenantId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mock sync failed";
    req.log.error({ err }, "Mock sync failed");
    res.status(500).json({ error: message });
  }
});

router.get("/ebay/poll-settings", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  if (settings.length === 0) {
    res.json({ pollIntervalMinutes: 0 });
    return;
  }
  res.json({ pollIntervalMinutes: settings[0].pollIntervalMinutes });
});

router.patch("/ebay/poll-settings", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const parsed = UpdateEbayPollSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  if (existing.length > 0) {
    await db.update(ebaySettingsTable)
      .set({ pollIntervalMinutes: parsed.data.pollIntervalMinutes })
      .where(eq(ebaySettingsTable.id, existing[0].id));
  } else {
    await db.insert(ebaySettingsTable).values({
      tenantId,
      pollIntervalMinutes: parsed.data.pollIntervalMinutes,
    });
  }

  res.json({ pollIntervalMinutes: parsed.data.pollIntervalMinutes });
});

export default router;
