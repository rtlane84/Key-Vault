import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import stripeRouter from "./routes/stripe";
import healthRouter from "./routes/health";

// Stripe webhook needs raw body — mount BEFORE express.json()
const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());

// Raw body for Stripe webhook — must be before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check (no auth)
app.use("/api", healthRouter);

// eBay callback MUST be public and handled BEFORE any requireAuth middleware
import ebayRouter from "./routes/ebay";

// Public eBay callback handler
app.get("/api/ebay/callback", (req, res, next) => {
  logger.info({ path: req.path, query: req.query }, "eBay callback handler reached (skipping auth)");
  // Execute the ebayRouter specifically for this path
  ebayRouter(req, res, next);
});

// Diagnostics for route matching
app.use("/api/ebay/connect", (req, res, next) => {
  const authHeader = req.headers.authorization;
  logger.info({ 
    path: req.path,
    originalUrl: req.originalUrl,
    method: req.method,
    hasAuth: !!authHeader,
    authPrefix: authHeader?.slice(0, 20)
  }, "Hit /api/ebay/connect diagnostic");
  next();
});

// Apply requireAuth to protected routes ONLY
import { requireAuth } from "./lib/auth";

// Mount eBay router — individual routes inside handle their own auth if needed
// but /ebay/callback was already handled above
app.use("/api", ebayRouter);

app.use("/api/stripe/connect", requireAuth);
app.use("/api/stripe/callback", (req, res, next) => next()); // Callback is public (uses JWT state)

app.use("/api/ebay/status", requireAuth);
app.use("/api/ebay/history", requireAuth);
app.use("/api/ebay/sync", requireAuth);
app.use("/api/ebay/poll-settings", requireAuth);

import ebayListingsRouter from "./routes/ebay-listings";
app.use("/api/ebay/listings", requireAuth);
app.use("/api/ebay/listings", ebayListingsRouter);

// Stripe routes
app.use("/api", stripeRouter);

// All other routes imported in routes/index.ts
import router from "./routes";
app.use("/api", router);

export default app;
