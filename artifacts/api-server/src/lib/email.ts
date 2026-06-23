import { Resend } from "resend";
import { logger } from "./logger";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "delivery@yourdomain.com";
const APP_NAME = process.env.APP_NAME ?? "Key Delivery";

function getResend(): Resend {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set. Cannot initialize Resend client.");
  }
  return new Resend(RESEND_API_KEY);
}

export interface SendLicenseEmailParams {
  to: string;
  buyerName?: string | null;
  productName: string;
  keyValue: string;
  orderId: number;
  purchaseDate: Date;
  emailTemplate?: string | null;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

const DEFAULT_TEMPLATE = `Hello {{buyerName}},

Thank you for your purchase of {{productName}}!

Your license key is:

{{keyValue}}

Order ID: {{orderId}}
Purchase Date: {{purchaseDate}}

If you have any questions or need support, please reply to this email.

Best regards,
{{appName}}`;

export async function sendLicenseEmail(params: SendLicenseEmailParams): Promise<{ success: boolean; error?: string }> {
  const vars = {
    buyerName: params.buyerName ?? "Customer",
    productName: params.productName,
    keyValue: params.keyValue,
    orderId: String(params.orderId),
    purchaseDate: params.purchaseDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    appName: APP_NAME,
  };

  const bodyText = renderTemplate(params.emailTemplate ?? DEFAULT_TEMPLATE, vars);

  if (!RESEND_API_KEY) {
    logger.info("RESEND_API_KEY not set — SIMULATING email send");
    logger.info(`
------------------------------------------------------------
SIMULATED EMAIL TO: ${params.to}
SUBJECT: Your ${params.productName} License Key — Order #${params.orderId}
BODY:
${bodyText}
------------------------------------------------------------
    `);
    return { success: true, error: "SIMULATED" };
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h2 style="color: #0ea5e9;">Your License Key</h2>
  <p>Hello ${vars.buyerName},</p>
  <p>Thank you for your purchase of <strong>${vars.productName}</strong>!</p>
  <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
    <p style="font-size: 12px; color: #6b7280; margin: 0 0 8px 0;">YOUR LICENSE KEY</p>
    <code style="font-size: 18px; font-weight: bold; letter-spacing: 2px; color: #0ea5e9;">${vars.keyValue}</code>
  </div>
  <p style="font-size: 14px; color: #6b7280;">Order ID: ${vars.orderId} · ${vars.purchaseDate}</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="font-size: 13px; color: #9ca3af;">Questions? Reply to this email.</p>
</body>
</html>`;

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `Your ${params.productName} License Key — Order #${params.orderId}`,
      text: bodyText,
      html: htmlBody,
    });

    if (result.error) {
      logger.error({ err: result.error }, "Resend API error");
      return { success: false, error: result.error.message };
    }

    logger.info({ orderId: params.orderId, to: params.to }, "License email sent");
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to send license email");
    return { success: false, error: msg };
  }
}
