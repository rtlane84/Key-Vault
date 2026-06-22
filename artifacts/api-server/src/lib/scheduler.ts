import { db, ebaySettingsTable } from "@workspace/db";
import { runRealEbaySync } from "./ebay-sync";
import { logger } from "./logger";

let pollTimeout: NodeJS.Timeout | null = null;

export async function startScheduler() {
  logger.info("Starting eBay polling scheduler");
  await scheduleNextTick();
}

async function scheduleNextTick() {
  try {
    const settings = await db.select().from(ebaySettingsTable).limit(1);
    const interval = settings[0]?.pollIntervalMinutes || 0;

    if (interval <= 0) {
      logger.info("eBay polling disabled (interval = 0)");
      // Check again in 1 minute if it has been enabled
      pollTimeout = setTimeout(scheduleNextTick, 60 * 1000);
      return;
    }

    logger.info(`Next eBay poll in ${interval} minutes`);
    pollTimeout = setTimeout(async () => {
      try {
        logger.info("Executing scheduled eBay poll");
        await runRealEbaySync();
      } catch (err) {
        logger.error({ err }, "Scheduled eBay sync failed");
      } finally {
        scheduleNextTick();
      }
    }, interval * 60 * 1000);
  } catch (err) {
    logger.error({ err }, "Error in scheduler, retrying in 1 minute");
    pollTimeout = setTimeout(scheduleNextTick, 60 * 1000);
  }
}
