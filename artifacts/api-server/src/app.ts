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

// Apply requireAuth to protected stripe routes BEFORE mounting stripeRouter
import { requireAuth } from "./lib/auth";
app.use("/api/stripe/connect", requireAuth);
app.use("/api/stripe/callback", (req, res, next) => next()); // Callback is public (uses JWT state)

// Stripe routes
app.use("/api", stripeRouter);

// All other routes imported in routes/index.ts
import router from "./routes";
app.use("/api", router);

export default app;
