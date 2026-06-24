import jwt from "jsonwebtoken";
import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, ebaySettingsTable, syncLogsTable, ebaySyncHistoryTable } from "@workspace/db";
import { runMockSync, runRealEbaySync } from "../lib/ebay-sync";
import { logger } from "../lib/logger";
import { UpdateEbayPollSettingsBody } from "@workspace/api-zod";
import crypto from "crypto";
import { getEbayConfig } from "../lib/ebay-config";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-123456";
const ebayConfig = getEbayConfig();

const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

router.get("/ebay/status", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const settings = await db.select().from(ebaySettingsTable).where(eq(ebaySettingsTable.tenantId, tenantId)).limit(1);
  const mockMode = ebayConfig.isMockMode;

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

router.get("/ebay/history", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const history = await db
    .select()
    .from(ebaySyncHistoryTable)
    .where(eq(ebaySyncHistoryTable.tenantId, tenantId))
    .orderBy(desc(ebaySyncHistoryTable.createdAt))
    .limit(50);
  
  res.json(history);
});

router.post("/ebay/connect", requireAuth, async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;

  logger.info({ 
    tenantId, 
    method: req.method, 
    path: req.path,
    hasTenantId: !!tenantId,
    authHeader: !!req.headers.authorization
  }, "POST /ebay/connect handler reached");

  if (ebayConfig.isMockMode) {
    res.json({ url: "#mock-mode-no-ebay-credentials" });
    return;
  }

  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized: Tenant ID missing" });
    return;
  }

  // Generate a signed state token containing tenantId
  const state = jwt.sign(
    { 
      tenantId: Number(tenantId), 
      nonce: Math.random().toString(36).slice(2) 
    }, 
    JWT_SECRET, 
    { expiresIn: "10m" }
  );

  const url = `${ebayConfig.authBase}/oauth2/authorize?client_id=${encodeURIComponent(ebayConfig.clientId)}&response_type=code&redirect_uri=${encodeURIComponent(ebayConfig.redirectUri)}&scope=${encodeURIComponent(EBAY_SCOPES)}&state=${state}`;
  
  logger.info({ 
    env: ebayConfig.env, 
    clientId: ebayConfig.clientId.substring(0, 10) + "...", 
    redirectUri: ebayConfig.redirectUri,
    tenantId: Number(tenantId)
  }, "Generated eBay OAuth URL");

  res.json({ url });
});

router.get("/ebay/callback", async (req, res): Promise<void> => {
  logger.info("eBay callback handler reached");
  const { code, state, error, error_description } = req.query;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3001";

  if (error || !code) {
    logger.warn({ error, error_description, query: req.query }, "eBay OAuth callback error");
    res.redirect(`${appUrl}/ebay?ebay_error=1`);
    return;
  }

  if (ebayConfig.isMockMode) {
    logger.error("eBay callback: missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
    res.redirect(`${appUrl}/ebay?ebay_error=missing_credentials`);
    return;
  }

  if (!state || typeof state !== "string") {
    logger.warn({ hasState: !!state }, "eBay callback missing state");
    res.redirect(`${appUrl}/ebay?ebay_error=missing_params`);
    return;
  }

  let tenantId: number;
  try {
    logger.info("eBay callback token exchange start");
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    
    if (!decoded.tenantId) {
      logger.error({ state }, "eBay callback: tenantId missing from decoded JWT state");
      res.redirect(`${appUrl}/ebay?ebay_error=invalid_state`);
      return;
    }

    tenantId = Number(decoded.tenantId);
    
    if (isNaN(tenantId) || tenantId <= 0) {
      logger.error({ tenantId, raw: decoded.tenantId }, "eBay callback: tenantId is not a valid positive integer");
      res.redirect(`${appUrl}/ebay?ebay_error=invalid_state`);
      return;
    }

    logger.info({ tenantId }, "eBay callback: decoded tenantId from state");
  } catch (err) {
    logger.warn({ err }, "eBay callback invalid or expired state");
    res.redirect(`${appUrl}/ebay?ebay_error=invalid_state`);
    return;
  }

  try {
    const credentials = Buffer.from(`${ebayConfig.clientId}:${ebayConfig.clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${ebayConfig.apiBase}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: ebayConfig.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      logger.error({ status: tokenRes.status, body: text }, "eBay token exchange failed");
      res.redirect(`${appUrl}/ebay?ebay_error=token_exchange_failed`);
      return;
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_token_expires_in: number;
    };

    logger.info({ tenantId }, "eBay callback token exchange success");

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    let sellerId: string | undefined;
    try {
      const identityRes = await fetch(`${ebayConfig.apiBase}/commerce/identity/v1/user/`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (identityRes.ok) {
        const identity = await identityRes.json() as { username?: string };
        sellerId = identity.username;
      }
    } catch {
      logger.warn("Could not fetch eBay seller identity");
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

    logger.info({ tenantId, sellerId }, "eBay tokens saved for tenant");

    await db.insert(syncLogsTable).values({
      tenantId,
      event: "oauth_connected",
      level: "info",
      message: `eBay account connected${sellerId ? ` (seller: ${sellerId})` : ""}`,
    });

    res.redirect(`${appUrl}/ebay?ebay_success=1`);
  } catch (err) {
    logger.error({ err }, "eBay OAuth callback failed");
    res.redirect(`${appUrl}/ebay?ebay_error=unknown`);
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

  res.json({ connected: false, mockMode: ebayConfig.isMockMode, sellerId: null, tokenExpiresAt: null, lastSyncAt: null });
});

router.post("/ebay/sync", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  try {
    const result = await runRealEbaySync(tenantId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    logger.error({ err, tenantId }, "eBay sync failed");
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
    logger.error({ err, tenantId }, "Mock sync failed");
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

router.post("/ebay/webhooks", async (req, res): Promise<void> => {
  // eBay Marketplace Account Deletion (Required for GDPR/Privacy)
  // Or MarketPlace Notifications
  logger.info({ body: req.body, headers: req.headers }, "eBay webhook received");

  // Handle Challenge (Required for webhook activation)
  const challengeCode = req.query.challenge_code as string;
  if (challengeCode) {
    const verificationToken = process.env.EBAY_WEBHOOK_VERIFICATION_TOKEN || "default_verification_token";
    const endpoint = `${process.env.VITE_API_URL}/api/ebay/webhooks`;
    
    const hash = crypto.createHash("sha256");
    hash.update(challengeCode);
    hash.update(verificationToken);
    hash.update(endpoint);
    const responseHash = hash.digest("hex");
    
    res.status(200).json({ challengeResponse: responseHash });
    return;
  }

  // Handle Notifications (MARKETPLACE_CHECKOUT_ORDER_MET)
  const notification = req.body;
  if (notification?.metadata?.topic === "MARKETPLACE_CHECKOUT_ORDER_MET") {
    // Note: We need to figure out which tenant this belongs to.
    // Usually the payload contains the seller's eBay username or ID.
    // For now, we log and wait for implementation of multi-tenant webhook dispatch.
    logger.info({ ebayOrderId: notification.notificationPayload?.orderId }, "eBay Order notification received");
  }

  res.status(200).send("OK");
});

export default router;
