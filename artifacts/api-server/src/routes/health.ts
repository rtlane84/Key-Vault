import { Router } from "express";
import { getEbayConfig } from "../lib/ebay-config";

const router = Router();

router.get("/health", (_req, res) => {
  const ebayConfig = getEbayConfig();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    ebay_client_id_exists: !!ebayConfig.clientId,
    ebay_client_id_length: ebayConfig.clientId.length,
    ebay_client_secret_exists: !!ebayConfig.clientSecret,
    ebay_redirect_uri_exists: !!ebayConfig.redirectUri,
    ebay_env: ebayConfig.env,
    ebay_mock_mode: ebayConfig.isMockMode
  });
});

export default router;
