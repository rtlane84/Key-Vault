import { db, ebaySettingsTable } from "@workspace/db";
import { gt } from "drizzle-orm";
import { runRealEbaySync } from "./ebay-sync";
import { logger } from "./logger";

let pollTimeout: NodeJS.Timeout | null = null;

export async function startScheduler() {
  logger.info("Starting multi-tenant eBay polling scheduler");
  await tick();
}

async function tick() {
  try {
    // Find all tenants with polling enabled
    const allSettings = await db
      .select()
      .from(ebaySettingsTable)
      .where(gt(ebaySettingsTable.pollIntervalMinutes, 0));

    logger.info(`Checking ${allSettings.length} tenants for scheduled polling`);

    for (const settings of allSettings) {
      const now = new Date();
      const lastSync = settings.lastSyncAt || new Date(0);
      const intervalMs = settings.pollIntervalMinutes * 60 * 1000;

      if (now.getTime() - lastSync.getTime() >= intervalMs) {
        logger.info({ tenantId: settings.tenantId }, "Executing scheduled eBay poll for tenant");
        try {
          await runRealEbaySync(settings.tenantId);
        } catch (err) {
          logger.error({ err, tenantId: settings.tenantId }, "Scheduled eBay sync failed for tenant");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in scheduler tick");
  } finally {
    // Check every minute
    pollTimeout = setTimeout(tick, 60 * 1000);
  }
}
