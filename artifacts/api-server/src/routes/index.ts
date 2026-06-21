import { Router, type IRouter } from "express";
import healthRouter from "./health";
import productsRouter from "./products";
import keysRouter from "./keys";
import ordersRouter from "./orders";
import ebayRouter from "./ebay";
import dashboardRouter from "./dashboard";
import syncLogsRouter from "./sync-logs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(keysRouter);
router.use(ordersRouter);
router.use(ebayRouter);
router.use(dashboardRouter);
router.use(syncLogsRouter);

export default router;
