import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { tenantsTable } from "./tenants";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  source: text("source").notNull().default("manual"), // manual | ebay | stripe
  status: text("status").notNull().default("pending"), // pending | paid | fulfilled | failed | refunded
  buyerEmail: text("buyer_email").notNull(),
  buyerName: text("buyer_name"),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: integer("quantity").notNull().default(1),
  // eBay
  ebayOrderId: text("ebay_order_id").unique(),
  ebayLineItemId: text("ebay_line_item_id"),
  ebayBuyerUsername: text("ebay_buyer_username"),
  // Stripe
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeSessionId: text("stripe_session_id").unique(),
  // Fulfillment
  assignedKeyId: integer("assigned_key_id"),
  assignedKeyValue: text("assigned_key_value"),
  keys: text("keys"), // JSON array for multi-quantity orders
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  ebayMarkedAt: timestamp("ebay_marked_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
