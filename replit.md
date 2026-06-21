# eBay Key Delivery Ops

Automated eBay license key delivery system. When a buyer completes a paid eBay purchase, the app automatically finds the order, assigns an available license key, and notifies the buyer.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + TailwindCSS + shadcn/ui

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (products, license_keys, orders, sync_logs, ebay_settings)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/ebay-sync.ts` — core sync logic (mock + real eBay)
- `artifacts/dashboard/src/pages/` — React pages (dashboard, products, orders, ebay, logs)

## Architecture decisions

- **OpenAPI-first**: All API contracts defined in `openapi.yaml` → codegen produces typed React Query hooks and Zod validators.
- **Idempotent order processing**: Each eBay order ID is checked for duplicates before processing — safe to re-run syncs without double-assigning keys.
- **Mock mode**: Full mock eBay sync built-in for testing without real eBay API access. Toggle by having/not having `EBAY_CLIENT_ID` set.
- **Atomic key assignment**: Keys are marked `assigned` immediately when an order is created — prevents race conditions.
- **Structured logging**: Every sync event, key assignment, failure, and OAuth action is recorded in `sync_logs`.

## Product

- **Dashboard** — live stats (available keys, orders, eBay status), alerts for out-of-stock products, activity feed, one-click sync
- **Products** — manage products with SKU and eBay listing ID mapping; import license keys in bulk
- **Orders** — view all orders (eBay + manual); filter by status/source; re-fulfill failed orders; create manual orders
- **eBay Integration** — OAuth flow to connect seller account; real sync and mock sync; live sync log
- **Logs** — full audit trail of every sync event, key assignment, and failure

## eBay OAuth Setup

1. Create an eBay Developer account at https://developer.ebay.com
2. Create a production application and get your `Client ID` and `Client Secret`
3. Set the OAuth redirect URI to: `https://your-domain.com/api/ebay/callback`
4. Set environment variables:
   - `EBAY_CLIENT_ID` — your eBay app Client ID
   - `EBAY_CLIENT_SECRET` — your eBay app Client Secret
   - `EBAY_REDIRECT_URI` — your callback URL

## Mock eBay Mode

If `EBAY_CLIENT_ID` is not set, the app runs in mock mode:
- "Run Mock Sync" button uses 3 built-in fake orders
- Fake orders use SKUs `WIN-PRO-2024`, `OFFICE-HOME-2024`, and `WIN-PRO-2024` (seeded products)
- Mock mode is safe — it uses the real DB and key assignment logic, just with fake eBay orders

## Scheduled Sync (Future Cron)

The sync logic lives in `artifacts/api-server/src/lib/ebay-sync.ts` as standalone async functions:
- `runMockSync()` — mock sync
- `runRealEbaySync()` — real eBay API sync

To add scheduled sync: call these functions from a cron job (node-cron, Render cron, Railway cron, Vercel cron) or external scheduler.

## Avoiding Duplicate Key Sending

Every eBay order is checked against `orders.ebay_order_id` before processing. If the order ID already exists, it is skipped and logged as `duplicate_skipped`. This is safe to run on any schedule.

## Future Webhook Support

eBay supports push notifications via their Notifications API. To add webhooks:
1. Register a webhook endpoint (e.g. `POST /api/ebay/webhook`) in your eBay developer app
2. Verify the `X-EBAY-SIGNATURE` header on incoming requests
3. Call `processOrder()` from `ebay-sync.ts` when a `CHECKOUT_BUYER_PAYMENT` event is received

## Deployment

Designed to run on Replit Deployments, Render, Railway, or any Node.js host with PostgreSQL.
- API server: Node.js, serves `/api/*`
- Frontend: Static Vite build, serves `/`
- Database: PostgreSQL (Replit built-in, Supabase, or Railway Postgres)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- The eBay OAuth callback redirects to `/ebay?connected=1` — ensure your EBAY_REDIRECT_URI points to `/api/ebay/callback`
- Product matching uses SKU first, then eBay Listing ID as fallback — both must be set correctly on the product

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
