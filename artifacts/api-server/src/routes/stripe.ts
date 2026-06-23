import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, productsTable, ordersTable, licenseKeysTable, tenantsTable } from "@workspace/db";
import { getStripe } from "../lib/stripe-client";
import { fulfillOrder } from "../lib/fulfillment";
import { logger } from "../lib/logger";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";

import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";

const router: IRouter = Router();

router.post("/stripe/checkout", async (req, res): Promise<void> => {
  const parsed = CreateCheckoutSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3001";
  const { productId, successUrl, cancelUrl } = parsed.data;

  const products = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (products.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const product = products[0];

  // Resolve tenant settings for Stripe
  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, product.tenantId)).limit(1);
  const tenant = tenants[0];

  if (!tenant || (!tenant.stripeSecretKey && !tenant.stripeUserId)) {
    res.status(500).json({ error: "Seller Stripe configuration missing" });
    return;
  }
  
  const availableKeys = await db
    .select()
    .from(licenseKeysTable)
    .where(
      and(
        eq(licenseKeysTable.productId, productId),
        eq(licenseKeysTable.status, "available"),
        eq(licenseKeysTable.tenantId, product.tenantId)
      )
    )
    .limit(1);

  if (availableKeys.length === 0) {
    logger.warn({ productId, tenantId: product.tenantId }, "Checkout failed: Product is out of stock");
    res.status(400).json({ error: "Product is out of stock" });
    return;
  }

  if (!product.active) {
    res.status(400).json({ error: "Product is not available" });
    return;
  }

  const stripe = getStripe(tenant.stripeSecretKey ?? undefined);
  const checkoutOptions: any = {
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: product.name,
          description: product.description ?? undefined,
          images: product.imageUrl ? [product.imageUrl] : undefined,
        },
        unit_amount: product.price,
      },
      quantity: 1, // Multi-quantity handled via quantity parameter in other routes? 
                   // Keeping 1 for now as per original code here.
    }],
    success_url: successUrl ?? `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${appUrl}/product/${product.slug}`,
    metadata: { 
      productId: String(product.id), 
      productSlug: product.slug,
      tenantId: String(product.tenantId)
    },
  };

  // If using Stripe Connect, collect fees or direct payment
  if (tenant.stripeUserId && !tenant.stripeSecretKey) {
    checkoutOptions.payment_intent_data = {
      application_fee_amount: 0, // Optional: add platform fee in cents
      transfer_data: {
        destination: tenant.stripeUserId,
      },
    };
  }

  const session = await stripe.checkout.sessions.create(checkoutOptions);

  res.json({ url: session.url });
});

router.post("/stripe/connect", async (req, res): Promise<void> => {
  const tenantId = (req as any).tenantId;
  const userId = (req as any).userId;
  const authHeader = req.headers.authorization;

  logger.info({ 
    tenantId, 
    userId, 
    hasAuth: !!authHeader,
    authPrefix: authHeader?.substring(0, 15)
  }, "Stripe Connect: Request received");

  if (!tenantId) {
    logger.error("Stripe Connect: req.tenantId is missing from request. Ensure requireAuth middleware is active and token is valid.");
    res.status(401).json({ error: "Unauthorized: Tenant ID missing" });
    return;
  }

  const clientId = process.env.STRIPE_CLIENT_ID;

  if (!clientId) {
    res.status(400).json({ error: "Stripe Connect not configured on server" });
    return;
  }

  const redirectUri = `${process.env.VITE_API_URL}/api/stripe/callback`;
  
  // Generate a signed state token containing tenantId
  // This avoids reliance on cookies which can fail across different ngrok/localhost hosts
  const state = jwt.sign(
    { 
      tenantId: Number(tenantId), 
      nonce: Math.random().toString(36).slice(2) 
    }, 
    JWT_SECRET, 
    { expiresIn: "10m" }
  );

  logger.info({ tenantId: Number(tenantId) }, "Stripe Connect: Starting OAuth flow");

  const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.json({ url });
});

router.get("/stripe/callback", async (req, res): Promise<void> => {
  const { code, state, error, error_description } = req.query;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3001";
  
  if (error) {
    logger.warn({ error, error_description }, "Stripe Connect callback error");
    res.redirect(`${appUrl}/settings?stripe_error=1`);
    return;
  }

  if (!code || !state || typeof state !== "string") {
    logger.warn({ 
      hasCode: !!code, 
      hasState: !!state 
    }, "Stripe Connect callback missing params");
    res.redirect(`${appUrl}/settings?stripe_error=missing_params`);
    return;
  }

  let tenantId: number;
  try {
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    
    if (!decoded.tenantId) {
      logger.error({ state }, "Stripe Connect callback: tenantId missing from decoded JWT state");
      res.redirect(`${appUrl}/settings?stripe_error=invalid_state`);
      return;
    }

    tenantId = Number(decoded.tenantId);
    
    if (isNaN(tenantId) || tenantId <= 0) {
      logger.error({ tenantId, raw: decoded.tenantId }, "Stripe Connect callback: tenantId is not a valid positive integer");
      res.redirect(`${appUrl}/settings?stripe_error=invalid_state`);
      return;
    }

    logger.info({ 
      tenantId, 
      decodedType: typeof decoded.tenantId,
      rawDecodedTenantId: decoded.tenantId 
    }, "Stripe Connect callback: decoded tenantId from state");
  } catch (err) {
    logger.warn({ err }, "Stripe Connect callback invalid or expired state");
    res.redirect(`${appUrl}/settings?stripe_error=invalid_state`);
    return;
  }

  const stripe = getStripe();

  try {
    logger.info({ code: code ? "REDACTED" : "MISSING" }, "Stripe Connect callback: exchanging code for token");
    const response = await stripe.oauth.token({
      grant_type: "authorization_code",
      code: code as string,
    });

    logger.info({ 
      stripe_user_id: response.stripe_user_id,
      stripe_publishable_key: response.stripe_publishable_key,
      access_token: response.access_token ? "PRESENT" : "MISSING"
    }, "Stripe Connect callback: token exchange successful");

    logger.info({ tenantId, stripe_user_id: response.stripe_user_id }, "Stripe Connect callback: updating tenant row");
    
    const updateResult = await db.update(tenantsTable)
      .set({
        stripeUserId: String(response.stripe_user_id),
      })
      .where(eq(tenantsTable.id, Number(tenantId)))
      .returning();

    logger.info({ 
      rowsAffected: updateResult.length,
      updatedTenantId: updateResult[0]?.id,
      newStripeUserId: updateResult[0]?.stripeUserId 
    }, "Stripe Connect callback: update execution result");

    if (updateResult.length === 0) {
      const allTenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
      logger.error({ 
        tenantIdAttempted: Number(tenantId), 
        existingTenantIds: allTenants.map(t => t.id) 
      }, "Stripe Connect callback: NO ROWS UPDATED");
    } else {
      // Re-query to be absolutely sure
      const verified = await db.select().from(tenantsTable).where(eq(tenantsTable.id, Number(tenantId))).limit(1);
      logger.info({ 
        verifiedStripeUserId: verified[0]?.stripeUserId 
      }, "Stripe Connect callback: post-update verification");
    }

    res.redirect(`${appUrl}/settings?stripe_success=1`);
  } catch (err) {
    logger.error({ err }, "Stripe OAuth token exchange failed");
    res.redirect(`${appUrl}/settings?stripe_error=token_exchange_failed`);
  }
});

// Raw body is required for Stripe webhook signature verification
// Mounted BEFORE express.json() in app.ts
router.post("/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  // We need to resolve the tenant first to get their webhook secret
  // However, we can't verify the signature without the secret.
  // In a real SaaS with custom domains/webhooks, we'd look up by the webhook ID or endpoint URL.
  // For now, we'll try a "global" secret for verification if provided, 
  // or we'll have to skip signature verification if we want per-tenant secrets without a dispatcher.
  
  // STRATEGY: We'll assume the webhook secret is global for now (infrastructure level), 
  // OR we'll use the tenantId from the metadata if we can extract it WITHOUT verification (risky).
  
  // Actually, for Phase 2, let's stick to a global webhook secret in ENV for simplicity, 
  // but fulfillment will use the tenant-specific Stripe client if metadata is present.
  
  const globalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!globalWebhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET not set");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event;
  try {
    // Verification uses global secret
    const stripe = getStripe(); 
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, globalWebhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).send(`Webhook Error: ${msg}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const productId = session.metadata?.productId ? parseInt(session.metadata.productId, 10) : null;
    const tenantId = session.metadata?.tenantId ? parseInt(session.metadata.tenantId, 10) : null;
    const buyerEmail = session.customer_details?.email ?? null;

    if (!productId || !buyerEmail || !tenantId) {
      logger.warn({ sessionId: session.id, productId, tenantId }, "Stripe webhook missing required metadata");
      res.json({ received: true });
      return;
    }

    // Idempotency check — skip if already processed for this session
    const existing = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.stripeSessionId, session.id),
          eq(ordersTable.tenantId, tenantId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      logger.info({ sessionId: session.id, tenantId }, "Stripe session already processed, skipping");
      res.json({ received: true });
      return;
    }

    // Create the paid order
    const [order] = await db.insert(ordersTable).values({
      tenantId,
      source: "stripe",
      status: "paid",
      buyerEmail,
      buyerName: session.customer_details?.name ?? null,
      productId,
      quantity: 1,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripeSessionId: session.id,
    }).returning();

    // Fulfill the order (assign key + send email)
    const result = await fulfillOrder({
      orderId: order.id,
    });

    if (!result.success) {
      logger.error({ orderId: order.id, error: result.error, tenantId }, "Stripe fulfillment failed");
      await db.update(ordersTable)
        .set({ status: "failed", failureReason: result.error })
        .where(
          and(
            eq(ordersTable.id, order.id),
            eq(ordersTable.tenantId, tenantId)
          )
        );
    }
  }

  res.json({ received: true });
});

export default router;
