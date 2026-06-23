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
`RESEND_API_KEY`: Your Resend API key. If omitted, the system will log emails to the console in "SIMULATED" mode instead of sending them.
`FROM_EMAIL`: The email address keys will be sent from (must be verified in Resend).
`APP_NAME`: (Optional) Your application name used in email templates.

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
