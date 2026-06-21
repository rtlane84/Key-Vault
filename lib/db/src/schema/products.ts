import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  ebayListingId: text("ebay_listing_id"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const licenseKeysTable = pgTable("license_keys", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  keyValue: text("key_value").notNull(),
  status: text("status").notNull().default("available"), // available | assigned | failed
  orderId: integer("order_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLicenseKeySchema = createInsertSchema(licenseKeysTable).omit({ id: true, createdAt: true });
export type InsertLicenseKey = z.infer<typeof insertLicenseKeySchema>;
export type LicenseKey = typeof licenseKeysTable.$inferSelect;
