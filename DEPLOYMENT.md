# Deployment Guide - Key Sender

This document provides instructions for deploying the Key Sender application to production.

## Infrastructure

- **Frontend:** [Vercel](https://vercel.com) (React/Vite)
- **Backend API:** [Railway](https://railway.app) (Node.js/Express)
- **Database:** [Supabase](https://supabase.com) (PostgreSQL)
- **Email:** [Resend](https://resend.com)
- **Payments:** [Stripe](https://stripe.com)
- **Marketplace:** [eBay Developer Portal](https://developer.ebay.com)

## Environment Variables

The following environment variables are required for the production environment:

### Database (Supabase)
`DATABASE_URL`: Connection string from Supabase (Transaction mode recommended).

### Authentication
`JWT_SECRET`: A long random string for signing JWT tokens.

### Stripe
`STRIPE_SECRET_KEY`: Your Stripe secret key (`sk_live_...` or `sk_test_...`).
`STRIPE_WEBHOOK_SECRET`: Secret for verifying Stripe webhooks.

### Email (Resend)
`RESEND_API_KEY`: Your Resend API key (`re_...`). If omitted, the system will log emails to the console in "SIMULATED" mode instead of sending them.
`FROM_EMAIL`: The email address keys will be sent from (must be a domain verified in your Resend account).
`APP_NAME`: (Optional) Your application name used in email templates (default: "Key Delivery").

### Verification
Once configured, you can test email delivery by:
1. Creating a manual order in the dashboard and fulfilling it.
2. Using the "Resend" button on any fulfilled order in the Orders page.
3. Checking the "Logs" page for `resend_email_success` or `resend_email_failed` events.

### eBay
`EBAY_CLIENT_ID`: eBay App ID (Client ID).
`EBAY_CLIENT_SECRET`: eBay Cert ID (Client Secret).
`EBAY_REDIRECT_URI`: Must match the redirect URI configured in eBay Developer Portal (e.g., `https://your-api.railway.app/api/ebay/callback`).

### App URL
`APP_URL`: The URL of your dashboard (frontend).
`NEXT_PUBLIC_APP_URL`: Same as above for frontend consumption.

## Deployment Steps

### 1. Database Setup (Supabase)

1. Create a new project in Supabase.
2. Go to the SQL Editor and run the migrations found in `lib/db/migrations` (if any) or use the schema definition to generate tables.
3. Obtain the `DATABASE_URL`.

### 2. Backend Deployment (Railway)

1. Connect your GitHub repository to Railway.
2. Add a new service for the `artifacts/api-server`.
3. Set the root directory to `artifacts/api-server` or use a workspace-aware build command.
4. Configure the environment variables listed above.
5. Railway will automatically detect the `package.json` and start the server.

### 3. Frontend Deployment (Vercel)

1. Connect your GitHub repository to Vercel.
2. Add a new project for the `artifacts/dashboard`.
3. Set the root directory to `artifacts/dashboard`.
4. Configure the environment variables (especially `VITE_API_URL` pointing to your Railway API).
5. Deploy.

## Local Testing with Stripe CLI

To test the Stripe checkout and webhook flow locally:

1. **Install Stripe CLI:** [Follow official instructions](https://stripe.com/docs/stripe-cli).
2. **Login:** `stripe login`
3. **Forward Webhooks:** Start forwarding webhooks to your local API server:
   ```bash
   stripe listen --forward-to localhost:5001/api/stripe/webhook
   ```
4. **Configure Webhook Secret:** Copy the `whsec_...` secret from the CLI output and add it to your `.env` file as `STRIPE_WEBHOOK_SECRET`.
5. **Create a Test Product:** In the Dashboard, create a product and ensure it has a valid Stripe Price ID (from your Stripe Dashboard in test mode).
6. **Trigger Payment:** 
   - Open the storefront product page.
   - Click "Buy Now".
   - Complete the Stripe checkout with a test card (e.g., `4242...`).
7. **Verify Fulfillment:** Check the API server logs and the Dashboard "Logs" page to confirm the order was created, a key was assigned, and an email was sent.

## Railway Configuration (`railway.json`)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "pnpm start",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

## Vercel Configuration (`vercel.json`)

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-api.railway.app/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```
