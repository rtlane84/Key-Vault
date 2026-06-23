import { eq, and } from "drizzle-orm";
import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable } from "@workspace/db";
import { sendLicenseEmail } from "./email";
import { logger } from "./logger";

export interface FulfillmentInput {
  orderId: number;
  productId: number;
  buyerEmail: string;
  buyerName?: string | null;
}

export interface FulfillmentResult {
  success: boolean;
  keyValue?: string;
  keyId?: number;
  emailSent?: boolean;
  error?: string;
}

async function logEvent(params: {
  event: string;
  level?: string;
  message: string;
  orderId?: number;
  productId?: number;
  keyId?: number;
  meta?: Record<string, unknown>;
}) {
  await db.insert(syncLogsTable).values({
    event: params.event,
    level: params.level ?? "info",
    message: params.message,
    orderId: params.orderId,
    productId: params.productId,
    keyId: params.keyId,
    meta: params.meta ? JSON.stringify(params.meta) : undefined,
  });
}

export async function fulfillOrder(input: FulfillmentInput): Promise<FulfillmentResult> {
  const { orderId, productId, buyerEmail, buyerName } = input;

  const products = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (products.length === 0) {
    return { success: false, error: `Product ${productId} not found` };
  }
  const product = products[0];

  // Find an available key
  const available = await db
    .select()
    .from(licenseKeysTable)
    .where(and(eq(licenseKeysTable.productId, productId), eq(licenseKeysTable.status, "available")))
    .limit(1);

  if (available.length === 0) {
    const msg = `No available keys for product "${product.name}"`;
    await logEvent({ event: "no_key_available", level: "error", message: msg, orderId, productId });
    return { success: false, error: msg };
  }

  const key = available[0];

  // Mark key assigned
  await db.update(licenseKeysTable).set({
    status: "assigned",
    orderId,
    assignedAt: new Date(),
  }).where(eq(licenseKeysTable.id, key.id));

  // Update order with key
  await db.update(ordersTable).set({
    assignedKeyId: key.id,
    assignedKeyValue: key.keyValue,
    status: "fulfilled",
    fulfilledAt: new Date(),
  }).where(eq(ordersTable.id, orderId));

  await logEvent({
    event: "key_assigned",
    message: `Key assigned to order #${orderId} for product "${product.name}"`,
    orderId,
    productId,
    keyId: key.id,
  });

  // Send email
  const emailResult = await sendLicenseEmail({
    to: buyerEmail,
    buyerName,
    productName: product.name,
    keyValue: key.keyValue,
    orderId,
    purchaseDate: new Date(),
    emailTemplate: product.emailTemplate,
  });

  if (emailResult.success) {
    // Mark key as delivered
    await db.update(licenseKeysTable).set({ status: "delivered", deliveredAt: new Date() }).where(eq(licenseKeysTable.id, key.id));
    await logEvent({
      event: "order_processed",
      message: emailResult.error === "SIMULATED" 
        ? `Order #${orderId} fulfilled (EMAIL SIMULATED - Key: ${key.keyValue})`
        : `Order #${orderId} fulfilled and email sent to ${buyerEmail}`,
      orderId,
      productId,
      keyId: key.id,
    });
  } else {
    logger.warn({ orderId, error: emailResult.error }, "Key assigned but email failed");
    await logEvent({
      event: "key_send_failed",
      level: "warn",
      message: `Key assigned but email failed for order #${orderId}: ${emailResult.error}`,
      orderId,
      productId,
      keyId: key.id,
    });
  }

  return {
    success: true,
    keyValue: key.keyValue,
    keyId: key.id,
    emailSent: emailResult.success,
  };
}
