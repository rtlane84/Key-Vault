import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const syncLogsTable = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  event: text("event").notNull(),
  level: text("level").notNull().default("info"), // info | warn | error
  ebayOrderId: text("ebay_order_id"),
  orderId: integer("order_id"),
  productId: integer("product_id"),
  keyId: integer("key_id"),
  message: text("message").notNull(),
  meta: text("meta"), // JSON string for extra context
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSyncLogSchema = createInsertSchema(syncLogsTable).omit({ id: true, createdAt: true });
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncLog = typeof syncLogsTable.$inferSelect;

export const ebaySettingsTable = pgTable("ebay_settings", {
  id: serial("id").primaryKey(),
  sellerId: text("seller_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(0), // 0 = disabled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEbaySettingsSchema = createInsertSchema(ebaySettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEbaySettings = z.infer<typeof insertEbaySettingsSchema>;
export type EbaySettings = typeof ebaySettingsTable.$inferSelect;

export const ebayListingsTable = pgTable("ebay_listings", {
  id: serial("id").primaryKey(),
  listingId: text("listing_id").notNull().unique(),
  title: text("title").notNull(),
  sku: text("sku"),
  price: integer("price"), // in cents
  quantity: integer("quantity").notNull().default(0),
  status: text("status").notNull().default("active"), // active | ended | unknown
  productId: integer("product_id"), // nullable — set when mapped
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEbayListingSchema = createInsertSchema(ebayListingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEbayListing = z.infer<typeof insertEbayListingSchema>;
export type EbayListing = typeof ebayListingsTable.$inferSelect;
