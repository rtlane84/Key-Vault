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
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your License Key</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f9fafb;">
  <div style="background-color: #ffffff; margin: 20px auto; padding: 40px; border-radius: 8px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #0284c7; font-size: 24px; font-weight: 700; margin: 0;">${APP_NAME}</h1>
    </div>
    
    <div style="margin-bottom: 32px;">
      <p style="font-size: 16px; margin: 0 0 16px 0;">Hello ${vars.buyerName},</p>
      <p style="font-size: 16px; margin: 0 0 16px 0;">Thank you for your purchase of <strong>${vars.productName}</strong>. Your payment was successful, and your license key is ready below.</p>
    </div>

    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 24px; margin-bottom: 32px; text-align: center;">
      <p style="font-size: 12px; font-weight: 600; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px 0;">Your License Key</p>
      <div style="background: #ffffff; border: 1px dashed #0ea5e9; border-radius: 6px; padding: 16px; display: inline-block; min-width: 80%;">
        <code style="font-family: 'Courier New', Courier, monospace; font-size: 20px; font-weight: 700; color: #0c4a6e; letter-spacing: 1px; word-break: break-all;">${vars.keyValue}</code>
      </div>
    </div>

    <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-bottom: 32px;">
      <h3 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin: 0 0 12px 0;">Order Details</h3>
      <table style="width: 100%; font-size: 14px; color: #4b5563;">
        <tr>
          <td style="padding: 4px 0;"><strong>Order ID:</strong></td>
          <td style="padding: 4px 0; text-align: right;">#${vars.orderId}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;"><strong>Date:</strong></td>
          <td style="padding: 4px 0; text-align: right;">${vars.purchaseDate}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;"><strong>Product:</strong></td>
          <td style="padding: 4px 0; text-align: right;">${vars.productName}</td>
        </tr>
      </table>
    </div>

    <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 32px;">
      <p style="font-size: 14px; color: #92400e; margin: 0;"><strong>Need help?</strong> If you have any issues with your key or need support, simply reply to this email or contact us at <a href="mailto:${FROM_EMAIL}" style="color: #b45309; text-decoration: underline;">${FROM_EMAIL}</a>.</p>
    </div>

    <div style="text-align: center; font-size: 13px; color: #9ca3af;">
      <p style="margin: 0 0 8px 0;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  </div>
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
