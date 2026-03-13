drop table if exists public.instruments;

create table public.instruments (
  symbol text primary key,
  name text not null,
  asset_type text not null,
  market text not null,
  exchange text,
  valuation numeric,
  currency text,
  sector text,
  industry text,
  category text,
  updated_at timestamptz not null default now()
);

create index if not exists instruments_asset_type_idx on public.instruments(asset_type);
create index if not exists instruments_market_idx on public.instruments(market);
create index if not exists instruments_exchange_idx on public.instruments(exchange);
create index if not exists instruments_valuation_idx on public.instruments(valuation);
create index if not exists instruments_sector_idx on public.instruments(sector);
create index if not exists instruments_industry_idx on public.instruments(industry);
create index if not exists instruments_category_idx on public.instruments(category);

alter table public.instruments enable row level security;

drop policy if exists "instruments_public_read" on public.instruments;
create policy "instruments_public_read"
on public.instruments
for select
using (true);
