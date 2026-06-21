import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const syncLogsTable = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  event: text("event").notNull(), // sync_started | sync_completed | order_processed | key_assigned | key_send_failed | no_key_available | duplicate_skipped | oauth_connected | oauth_disconnected
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEbaySettingsSchema = createInsertSchema(ebaySettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEbaySettings = z.infer<typeof insertEbaySettingsSchema>;
export type EbaySettings = typeof ebaySettingsTable.$inferSelect;
