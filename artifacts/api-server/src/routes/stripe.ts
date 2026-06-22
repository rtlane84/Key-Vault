import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable, ordersTable } from "@workspace/db";
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

  if (!product.active) {
    res.status(400).json({ error: "Product is not available" });
    return;
  }

  if (!product.stripePriceId) {
    res.status(400).json({ error: "Product has no Stripe Price ID configured" });
    return;
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: product.stripePriceId, quantity: 1 }],
    success_url: successUrl ?? `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${appUrl}/product/${product.slug}`,
    metadata: { productId: String(product.id), productSlug: product.slug },
  });

  res.json({ url: session.url });
});

// Raw body is required for Stripe webhook signature verification
// Mounted BEFORE express.json() in app.ts
router.post("/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
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
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).send(`Webhook Error: ${msg}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const productId = session.metadata?.productId ? parseInt(session.metadata.productId, 10) : null;
    const buyerEmail = session.customer_details?.email ?? null;

    if (!productId || !buyerEmail) {
      logger.warn({ sessionId: session.id }, "Stripe webhook missing productId or buyerEmail");
      res.json({ received: true });
      return;
    }

    // Idempotency check — skip if already processed for this session
    const existing = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.stripeSessionId, session.id))
      .limit(1);

    if (existing.length > 0) {
      logger.info({ sessionId: session.id }, "Stripe session already processed, skipping");
      res.json({ received: true });
      return;
    }

    // Create the pending order first
    const [order] = await db.insert(ordersTable).values({
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
      productId,
      buyerEmail,
      buyerName: order.buyerName,
    });

    if (!result.success) {
      logger.error({ orderId: order.id, error: result.error }, "Stripe fulfillment failed");
      await db.update(ordersTable).set({ status: "failed", failureReason: result.error }).where(eq(ordersTable.id, order.id));
    }
  }

  res.json({ received: true });
});

export default router;
