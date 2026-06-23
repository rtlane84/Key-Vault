import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, productsTable, ordersTable, licenseKeysTable, tenantsTable } from "@workspace/db";
import { getStripe } from "../lib/stripe-client";
import { fulfillOrder } from "../lib/fulfillment";
import { logger } from "../lib/logger";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";

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

  if (!tenant || !tenant.stripeSecretKey) {
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
    res.status(400).json({ error: "Product is out of stock" });
    return;
  }

  if (!product.active) {
    res.status(400).json({ error: "Product is not available" });
    return;
  }

  const stripe = getStripe(tenant.stripeSecretKey);
  const session = await stripe.checkout.sessions.create({
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
      quantity: 1,
    }],
    success_url: successUrl ?? `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${appUrl}/product/${product.slug}`,
    metadata: { 
      productId: String(product.id), 
      productSlug: product.slug,
      tenantId: String(product.tenantId)
    },
  });

  res.json({ url: session.url });
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
