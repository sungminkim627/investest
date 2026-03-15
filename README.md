# Investest V1

Production-grade fintech web app using Next.js (App Router), Supabase (Postgres + Auth), and Tiingo market data.

## Why Tiingo

Tiingo was selected for V1 because it provides:
- reliable US equities + ETF symbol search endpoint
- adjusted end-of-day historical prices
- a straightforward REST API surface
- an MVP-friendly free tier

## Stack

- Next.js 15 + TypeScript
- TailwindCSS + shadcn-style UI primitives
- Recharts for performance visualizations
- Supabase for Postgres + Google OAuth auth
- Vercel API routes (`/api/analyze`, `/api/search`, `/api/prices`)

## Project Structure

- `src/app` pages + API routes
- `src/components` UI and domain components
- `src/lib/api` market provider integration
- `src/lib/portfolio` cache + analytics engine
- `src/lib/supabase` client/server/admin helpers
- `supabase/migrations` schema + RLS migration SQL

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment file and fill values:
   ```bash
   cp .env.example .env.local
   ```
3. Run app:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000)

## Supabase Setup

1. Create a Supabase project.
2. In SQL Editor, run migration from:
   - `supabase/migrations/20260221153000_init_investest.sql`
   - `supabase/migrations/20260222103000_instruments_catalog.sql`
   - `supabase/migrations/20260227181000_instruments_enrichment.sql`
   - `supabase/migrations/20260228000500_universe_refactor.sql`
   - `supabase/migrations/20260302223000_instruments_schema_v2.sql`
   - `supabase/migrations/20260302231000_instruments_drop_exchange.sql`
3. In Authentication > Providers, enable Google.
4. Add redirect URL:
   - `http://localhost:3000/auth/callback`
   - your production URL (e.g. `https://your-app.vercel.app/auth/callback`)
5. Copy keys into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Tiingo Setup

1. Create a Tiingo account and API token.
2. Set up weekly yfinance sync (see scripts) to populate Supabase prices.

## Symbol Universe Sync

Universe strategy (CSV-driven):
- Import 4 TradingView exports (US/CAN stocks and ETFs)
- Normalize and dedupe symbols
- Replace `public.instruments` with curated rows
- Apply caps:
  - Stocks US: 1000
  - Stocks Canada: 250
  - ETFs US: 500
  - ETFs Canada: 250

Autocomplete uses Supabase `public.instruments` as the canonical search source.

1. Install Python deps:
   ```bash
   pip install pandas
   ```
2. Rebuild curated universe:
   ```bash
   npm run sync:universe
   ```
   Put the 4 CSV files in `data/universe` with filename keywords:
   - contains `stock` + `us`
   - contains `stock` + `can`
   - contains `etf` + `us`
   - contains `etf` + `can`
3. Optional metadata normalization pass:
   ```bash
   npm run sync:instrument-profiles
   ```
4. Weekly price sync (weekly bars via yfinance):
   ```bash
   pip install yfinance pandas
   npm run sync:prices:weekly
   ```
   Default behavior is incremental (`3mo`, `1wk` interval) and upserts into `prices_daily`.
   This run also refreshes instrument metadata (sector, industry, valuations, etc.) from Yahoo Finance.
   For a full 10Y backfill run:
   ```bash
   npm run sync:prices:weekly:backfill
   ```
   You can also run only prices or only metadata:
   ```bash
   python3 scripts/sync-weekly-prices.py --prices-only
   python3 scripts/sync-weekly-prices.py --metadata-only
   ```
   Optional env controls:
   - `WEEKLY_PRICE_SYNC_MODE` (`incremental` or `backfill`)
   - `WEEKLY_PRICE_INCREMENTAL_PERIOD` (default `3mo`)
   - `WEEKLY_PRICE_BACKFILL_PERIOD` (default `10y`)
   - `WEEKLY_PRICE_BATCH_SIZE`
   - `WEEKLY_PRICE_PAUSE_SECONDS`
   - `WEEKLY_METADATA_SYNC` (default `1`)
   - `WEEKLY_METADATA_PAUSE_SECONDS`
5. This enriches `public.instruments` with:
   - symbol search
   - company/instrument name search
   - short "what they do" descriptions (trimmed to concise length)
   - sector + industry classification
   - description-based matching in search

`sync:instrument-profiles` uses FinanceDatabase locally and does not consume Tiingo API requests.
It performs full rewrite-style upsert for active instruments in Supabase.

## Monthly Refresh Job

Use your local CSV export process monthly, then run:
```bash
npm run sync:universe
```

Use your recurring weekly price refresh process with:
```bash
npm run sync:prices:weekly
```

## Data Caching Flow (Permanent)

On `/api/analyze`:
1. Read `prices_daily` for each required symbol and date range.
2. Compute portfolio + benchmark analytics from cached weekly prices.

`prices_daily` stores only:
- `symbol`
- `date`
- `adj_close`

With unique `(symbol, date)` to prevent duplicates.

## Deploy to Vercel

1. Push repo to GitHub.
2. Import project in Vercel.
3. Add env vars from `.env.example`.
4. Set production `NEXT_PUBLIC_APP_URL` to your Vercel domain.
5. Deploy.

## Required Endpoints

- `POST /api/analyze`
- `GET /api/search?query=...`
- `GET /api/prices?symbol=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
