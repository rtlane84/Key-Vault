import { Router, type IRouter } from "express";
import { signToken, verifyPassword } from "../lib/auth";
import { AdminLoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    res.status(500).json({ error: "Admin credentials not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD." });
    return;
  }

  if (parsed.data.email !== adminEmail) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Support both plaintext (dev) and bcrypt-hashed passwords
  const isValid = adminPassword.startsWith("$2")
    ? verifyPassword(parsed.data.password, adminPassword)
    : parsed.data.password === adminPassword;

  if (!isValid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({ email: parsed.data.email });
  res.json({ token });
});

export default router;
