import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("manual"), // manual | ebay
  status: text("status").notNull().default("pending"), // pending | fulfilled | failed
  buyerEmail: text("buyer_email").notNull(),
  buyerName: text("buyer_name"),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  ebayOrderId: text("ebay_order_id").unique(),
  ebayLineItemId: text("ebay_line_item_id"),
  assignedKeyId: integer("assigned_key_id"),
  assignedKeyValue: text("assigned_key_value"),
  failureReason: text("failure_reason"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
