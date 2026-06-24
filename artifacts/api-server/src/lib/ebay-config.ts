import { logger } from "./logger";

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  env: "sandbox" | "production";
  authBase: string;
  apiBase: string;
  isMockMode: boolean;
}

export function getEbayConfig(): EbayConfig {
  const clientId = (process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.EBAY_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.EBAY_REDIRECT_URI || "").trim();
  const envRaw = (process.env.EBAY_ENV || "production").trim().toLowerCase();
  const env = envRaw === "sandbox" ? "sandbox" : "production";

  const authBase = env === "sandbox" ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com";
  const apiBase = env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

  const isMockMode = !clientId || !clientSecret;

  return {
    clientId,
    clientSecret,
    redirectUri,
    env,
    authBase,
    apiBase,
    isMockMode,
  };
}

// Log config on load (once)
const config = getEbayConfig();
logger.info({
  env: config.env,
  clientIdExists: !!config.clientId,
  clientIdLength: config.clientId.length,
  clientSecretExists: !!config.clientSecret,
  redirectUriExists: !!config.redirectUri,
  isMockMode: config.isMockMode,
  authBase: config.authBase,
  apiBase: config.apiBase
}, "eBay Configuration Loaded");
