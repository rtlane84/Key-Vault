import { Router, type IRouter } from "express";
import { signToken, verifyPassword } from "../lib/auth";
import { AdminLoginBody } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  // Find user in database
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, parsed.data.email),
  });

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const isValid = verifyPassword(parsed.data.password, user.passwordHash);

  if (!isValid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({ email: user.email, tenantId: user.tenantId });
  res.json({ token });
});

export default router;
