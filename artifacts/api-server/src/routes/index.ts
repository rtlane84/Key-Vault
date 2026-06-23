import { Router, type IRouter } from "express";
import { requireAuth, hashPassword } from "../lib/auth";
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
import { db, tenantsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);

// Registration (MVP Onboarding)
router.post("/auth/register", async (req, res) => {
  const { email, password, name, slug } = req.body;

  if (!email || !password || !name || !slug) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    const [tenant] = await db.insert(tenantsTable).values({
      name,
      slug,
    }).returning();

    const [user] = await db.insert(usersTable).values({
      tenantId: tenant.id,
      email,
      passwordHash: hashPassword(password),
      role: "owner",
    }).returning();

    res.status(201).json({ 
      message: "Registration successful", 
      userId: user.id, 
      tenantId: tenant.id 
    });
  } catch (err: any) {
    if (err.code === "23505") { // Unique violation
      res.status(409).json({ error: "Email or slug already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
router.use(publicProductsRouter); // storefront product endpoints
router.use(ordersRouter); // Added ordersRouter here for public /orders/lookup

// All routes below this line require a valid JWT
router.use(requireAuth);
router.use(productsRouter);
router.use(keysRouter);
// router.use(ordersRouter); // Already added above, which has internal auth handling
router.use(ebayRouter);
router.use(ebayListingsRouter);
router.use(dashboardRouter);
router.use(syncLogsRouter);

export default router;
