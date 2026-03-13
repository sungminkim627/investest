create extension if not exists pg_trgm;

create table if not exists public.instruments (
  symbol text primary key,
  name text not null,
  exchange text,
  asset_type text,
  description text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists instruments_symbol_idx on public.instruments(symbol);
create index if not exists instruments_name_idx on public.instruments(name);
create index if not exists instruments_symbol_trgm_idx on public.instruments using gin (symbol gin_trgm_ops);
create index if not exists instruments_name_trgm_idx on public.instruments using gin (name gin_trgm_ops);

alter table public.instruments enable row level security;

drop policy if exists "instruments_public_read" on public.instruments;
create policy "instruments_public_read"
on public.instruments
for select
using (true);
