# Production Deployment Guide

This guide explains how to deploy the Key Sender system to production using Railway (API), Vercel (Frontend), and Supabase (Database).

## 1. Database Setup (Supabase)

1.  Create a new project on [Supabase](https://supabase.com/).
2.  Go to **Project Settings** -> **Database** and copy the **Connection String** (Transaction mode, port 5432).
3.  Ensure you have your database password ready.
4.  Run the following command from the project root to initialize the schema:
    ```bash
    DATABASE_URL="your_supabase_connection_string" pnpm run db:push
    ```

## 2. API Deployment (Railway)

1.  Create a new project on [Railway](https://railway.app/).
2.  Connect your GitHub repository.
3.  In the **Settings** tab, set the **Root Directory** to `/`.
4.  In the **Variables** tab, add all variables from `.env.example`.
    - `PORT`: 3000 (Railway will assign this automatically, but good to have a default).
    - `NODE_ENV`: production
5.  Railway will detect the `package.json` in the root and try to run `build` and `start`.
6.  Ensure the **Build Command** is `pnpm install && pnpm run api:build`.
7.  Ensure the **Start Command** is `pnpm run api:start`.

**Note on eBay Sync**: The eBay order polling requires the API server to remain active. Ensure your Railway plan does not "sleep" due to inactivity, or the background scheduler will stop running.

## 3. Dashboard & Storefront Deployment (Vercel)

You will need two separate Vercel projects: one for the Dashboard and one for the Storefront.

### Dashboard Setup
1.  Connect your repository to Vercel.
2.  Set **Root Directory** to `artifacts/dashboard`.
3.  **Framework Preset**: Vite.
4.  **Environment Variables**:
    - `VITE_API_URL`: `https://your-api-url.railway.app/api`
5.  **Build Command**: `cd ../.. && pnpm install && pnpm run dashboard:build`.
6.  **Output Directory**: `dist`.

### Storefront Setup
1.  Connect your repository to Vercel again.
2.  Set **Root Directory** to `artifacts/storefront`.
3.  **Framework Preset**: Vite.
4.  **Environment Variables**:
    - `VITE_API_URL`: `https://your-api-url.railway.app/api`
5.  **Build Command**: `cd ../.. && pnpm install && pnpm run storefront:build`.
6.  **Output Directory**: `dist`.

## 4. External Service Configuration

### Stripe
1.  **Platform Setup**:
    - Go to **Stripe Dashboard** -> **Connect** -> **Settings**.
    - Complete your platform profile.
    - Copy your **Client ID** (`ca_...`) and add it as `STRIPE_CLIENT_ID` in your API environment variables.
2.  **Redirect URI**:
    - Add `https://your-api-url.railway.app/api/stripe/callback` to your Stripe Connect redirect URIs.
3.  **Webhook**:
    - Go to **Stripe Dashboard** -> **Developers** -> **Webhooks**.
    - Add an endpoint: `https://your-api-url.railway.app/api/stripe/webhook`.
    - Select events: `checkout.session.completed`.
    - Copy the **Signing Secret** and add it as `STRIPE_WEBHOOK_SECRET` in Railway.
4.  **Seller Onboarding**:
    - Sellers can now go to the **Settings** page in their Dashboard and click "Connect Stripe" to automatically link their account and receive payments.

### Resend
1.  Go to [Resend](https://resend.com/) and verify your domain.
2.  Generate an API key and add it as `RESEND_API_KEY` in Railway.
3.  Set `FROM_EMAIL` to an email using your verified domain.

### eBay
1.  Go to the [eBay Developer Portal](https://developer.ebay.com/).
2.  Create an Application and get your **App ID** and **Cert ID**.
3.  Add `https://your-api-url.railway.app/api/ebay/callback` as a **Redirect URI** in the eBay portal.
4.  Set `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, and `EBAY_REDIRECT_URI` in Railway.
5.  Once deployed, navigate to the Dashboard settings and complete the eBay authorization flow.

## 5. Maintenance & Health Checks

- **Health Check**: Monitor `https://your-api-url.railway.app/api/health` to verify the API is running.
- **Logs**: Check Railway logs for background task status (eBay sync).
- **Database**: Use the Supabase dashboard to monitor orders and sync logs.
