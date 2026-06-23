import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const syncLogsTable = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
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
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  sellerId: text("seller_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(0), // 0 = disabled
  ebayNotificationSecret: text("ebay_notification_secret"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEbaySettingsSchema = createInsertSchema(ebaySettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEbaySettings = z.infer<typeof insertEbaySettingsSchema>;
export type EbaySettings = typeof ebaySettingsTable.$inferSelect;

export const ebayListingsTable = pgTable("ebay_listings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
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

export const ebaySyncHistoryTable = pgTable("ebay_sync_history", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  type: text("type").notNull(), // orders | listings
  status: text("status").notNull(), // success | partial | failure
  ordersFound: integer("orders_found").default(0),
  ordersProcessed: integer("orders_processed").default(0),
  keysAssigned: integer("keys_assigned").default(0),
  listingsSynced: integer("listings_synced").default(0),
  failedCount: integer("failed_count").default(0),
  errors: text("errors"), // JSON array of error messages
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEbaySyncHistorySchema = createInsertSchema(ebaySyncHistoryTable).omit({ id: true, createdAt: true });
export type InsertEbaySyncHistory = z.infer<typeof insertEbaySyncHistorySchema>;
export type EbaySyncHistory = typeof ebaySyncHistoryTable.$inferSelect;
