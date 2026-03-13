alter table public.instruments
  add column if not exists country text,
  add column if not exists universe_source text,
  add column if not exists aum_usd numeric;

create index if not exists instruments_country_idx on public.instruments(country);
create index if not exists instruments_asset_type_idx on public.instruments(asset_type);
create index if not exists instruments_sector_idx on public.instruments(sector);
create index if not exists instruments_industry_idx on public.instruments(industry);
create index if not exists instruments_aum_usd_idx on public.instruments(aum_usd);
