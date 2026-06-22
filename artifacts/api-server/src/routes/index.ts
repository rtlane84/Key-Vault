import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import healthRouter from "./health";
import authRouter from "./auth";
import publicProductsRouter from "./public-products";
import productsRouter from "./products";
import keysRouter from "./keys";
import ordersRouter from "./orders";
import ebayRouter from "./ebay";
import ebayListingsRouter from "./ebay-listings";
import dashboardRouter from "./dashboard";
import syncLogsRouter from "./sync-logs";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);
router.use(publicProductsRouter); // storefront product endpoints

// All routes below this line require a valid JWT
router.use(requireAuth);
router.use(productsRouter);
router.use(keysRouter);
router.use(ordersRouter);
router.use(ebayRouter);
router.use(ebayListingsRouter);
router.use(dashboardRouter);
router.use(syncLogsRouter);

export default router;
