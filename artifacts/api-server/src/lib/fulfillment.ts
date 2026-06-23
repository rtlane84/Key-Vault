import { eq, and, sql, inArray } from "drizzle-orm";
import { db, productsTable, licenseKeysTable, ordersTable, syncLogsTable } from "@workspace/db";
import { sendLicenseEmail } from "./email";
import { logger } from "./logger";
import { markOrderAsFulfilledOnEbay } from "./ebay-sync";

export interface FulfillmentInput {
  orderId: number;
}

export interface FulfillmentResult {
  success: boolean;
  keys?: string[];
  emailSent?: boolean;
  ebayMarked?: boolean;
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
  try {
    await db.insert(syncLogsTable).values({
      event: params.event,
      level: params.level ?? "info",
      message: params.message,
      orderId: params.orderId,
      productId: params.productId,
      keyId: params.keyId,
      meta: params.meta ? JSON.stringify(params.meta) : undefined,
    });
  } catch (err) {
    logger.error({ err }, "Failed to log event to database");
  }
}

export async function fulfillOrder(input: FulfillmentInput): Promise<FulfillmentResult> {
  const { orderId } = input;

  try {
    // 1. Transactional Key Assignment
    const result = await db.transaction(async (tx) => {
      // Get order and lock it
      const orders = await tx
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, orderId))
        .for("update");

      if (orders.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }
      const order = orders[0];

      // Idempotency: If already fulfilled, return current keys
      if (order.status === "fulfilled" && order.keys) {
        return {
          order,
          keys: JSON.parse(order.keys) as string[],
          alreadyFulfilled: true,
        };
      }

      // Get product
      const products = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, order.productId));

      if (products.length === 0) {
        throw new Error(`Product ${order.productId} not found`);
      }
      const product = products[0];

      // Find available keys and lock them
      // We use FOR UPDATE SKIP LOCKED to avoid contention if multiple processes are looking for keys
      const available = await tx
        .select()
        .from(licenseKeysTable)
        .where(
          and(
            eq(licenseKeysTable.productId, order.productId),
            eq(licenseKeysTable.status, "available")
          )
        )
        .limit(order.quantity)
        .for("update", { skipLocked: true });

      if (available.length < order.quantity) {
        const msg = `Insufficient inventory for product "${product.name}". Requested: ${order.quantity}, Available: ${available.length}`;
        await logEvent({
          event: "insufficient_inventory",
          level: "error",
          message: msg,
          orderId,
          productId: product.id,
        });
        
        await tx.update(ordersTable)
          .set({ 
            status: "failed", 
            failureReason: "insufficient_inventory",
            updatedAt: new Date() 
          })
          .where(eq(ordersTable.id, orderId));
          
        throw new Error(msg);
      }

      const assignedKeys = available.map(k => k.keyValue);
      const assignedKeyIds = available.map(k => k.id);

      // Mark keys assigned
      await tx.update(licenseKeysTable)
        .set({
          status: "assigned",
          orderId,
          assignedAt: new Date(),
        })
        .where(inArray(licenseKeysTable.id, assignedKeyIds));

      // Update order with keys
      await tx.update(ordersTable)
        .set({
          assignedKeyId: assignedKeyIds[0], // legacy support
          assignedKeyValue: assignedKeys[0], // legacy support
          keys: JSON.stringify(assignedKeys),
          status: "fulfilled",
          fulfilledAt: new Date(),
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(ordersTable.id, orderId));

      await logEvent({
        tx,
        event: "keys_assigned",
        message: `${assignedKeys.length} keys assigned to order #${orderId} for product "${product.name}"`,
        orderId,
        productId: product.id,
        meta: { keysCount: assignedKeys.length, buyerEmail: order.buyerEmail },
      } as any); // logEvent doesn't support tx yet, but we'll fix it if needed or just use db

      return { order, product, keys: assignedKeys, alreadyFulfilled: false };
    });

    if (result.alreadyFulfilled) {
      // If already fulfilled, we might still want to try resending email if it failed before
      // But for now, let's follow requirements: "Resend should resend the same keys already assigned"
      // We will handle explicit resend separately or just skip here.
      // Requirements say: "Ensure resend email does NOT assign a new key."
      return { success: true, keys: result.keys, emailSent: !!result.order.emailSentAt };
    }

    const { order, product, keys } = result;

    // 2. Send Email
    const emailResult = await sendLicenseEmail({
      to: order.buyerEmail,
      buyerName: order.buyerName,
      productName: product!.name,
      keyValue: keys.join("\n"), // If multi-quantity, send all keys
      orderId,
      purchaseDate: order.createdAt,
      activationInstructions: product!.activationInstructions,
      emailTemplate: product!.emailTemplate,
    });

    if (emailResult.success) {
      await db.update(ordersTable)
        .set({ emailSentAt: new Date() })
        .where(eq(ordersTable.id, orderId));
      
      await db.update(licenseKeysTable)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(licenseKeysTable.orderId, orderId));

      await logEvent({
        event: "email_sent",
        message: `Email sent for order #${orderId} to ${order.buyerEmail}`,
        orderId,
        productId: order.productId,
      });
    } else {
      logger.warn({ orderId, error: emailResult.error }, "Keys assigned but email failed");
      await logEvent({
        event: "email_failed",
        level: "warn",
        message: `Email failed for order #${orderId}: ${emailResult.error}`,
        orderId,
        productId: order.productId,
      });
    }

    // 3. eBay Fulfillment Mark
    let ebayMarked = false;
    if (order.source === "ebay" && order.ebayOrderId) {
      if (emailResult.success) {
        ebayMarked = await markOrderAsFulfilledOnEbay(order.ebayOrderId, orderId);
        if (ebayMarked) {
          await db.update(ordersTable)
            .set({ ebayMarkedAt: new Date() })
            .where(eq(ordersTable.id, orderId));
        } else {
          // Logged inside markOrderAsFulfilledOnEbay
          logger.warn({ orderId, ebayOrderId: order.ebayOrderId }, "Email sent but eBay mark failed");
        }
      } else {
        logger.info({ orderId }, "Skipping eBay mark because email failed");
      }
    }

    return {
      success: true,
      keys,
      emailSent: emailResult.success,
      ebayMarked,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ orderId, error: msg }, "Fulfillment failed");
    return { success: false, error: msg };
  }
}
