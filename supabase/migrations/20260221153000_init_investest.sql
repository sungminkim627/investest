create extension if not exists "pgcrypto";

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol text not null,
  weight numeric not null check (weight >= 0)
);

create table if not exists public.prices_daily (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  market text not null default 'US',
  date date not null,
  adj_close numeric not null,
  created_at timestamptz not null default now(),
  unique(symbol, market, date)
);

create index if not exists prices_daily_symbol_market_idx on public.prices_daily(symbol, market);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row
execute function public.set_updated_at();

alter table public.portfolios enable row level security;
alter table public.portfolio_holdings enable row level security;
alter table public.prices_daily enable row level security;

create policy "portfolios_select_own"
on public.portfolios
for select
using (auth.uid() = user_id);

create policy "portfolios_insert_own"
on public.portfolios
for insert
with check (
  auth.uid() = user_id
  and (
    select count(*)
    from public.portfolios p
    where p.user_id = auth.uid()
  ) < 5
);

create policy "portfolios_update_own"
on public.portfolios
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "portfolios_delete_own"
on public.portfolios
for delete
using (auth.uid() = user_id);

create policy "holdings_select_own"
on public.portfolio_holdings
for select
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  )
);

create policy "holdings_insert_own"
on public.portfolio_holdings
for insert
with check (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  )
);

create policy "holdings_update_own"
on public.portfolio_holdings
for update
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  )
);

create policy "holdings_delete_own"
on public.portfolio_holdings
for delete
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  )
);

create policy "prices_public_read"
on public.prices_daily
for select
using (true);
