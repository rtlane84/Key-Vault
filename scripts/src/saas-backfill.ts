import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Starting SaaS foundation backfill...");

  // 1. Ensure Default Tenant
  const existingTenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.slug, "default"),
  });

  let tenantId = 1;

  if (!existingTenant) {
    console.log("Creating default tenant...");
    const [newTenant] = await db.insert(tenantsTable).values({
      name: "Default Owner",
      slug: "default",
      status: "active",
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      resendApiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.FROM_EMAIL,
    }).returning();
    tenantId = newTenant.id;
    console.log(`Default tenant created with ID: ${tenantId}`);
  } else {
    tenantId = existingTenant.id;
    console.log(`Default tenant already exists with ID: ${tenantId}`);
  }

  // 2. Ensure Default User (from ENV)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const existingUser = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, adminEmail),
    });

    if (!existingUser) {
      console.log(`Creating default user: ${adminEmail}...`);
      const passwordHash = adminPassword.startsWith("$2") 
        ? adminPassword 
        : bcrypt.hashSync(adminPassword, 10);

      await db.insert(usersTable).values({
        tenantId,
        email: adminEmail,
        passwordHash,
        role: "owner",
      });
      console.log("Default user created.");
    } else {
      console.log("Default user already exists.");
    }
  } else {
    console.warn("ADMIN_EMAIL or ADMIN_PASSWORD not set. Skipping user creation.");
  }

  console.log("Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
