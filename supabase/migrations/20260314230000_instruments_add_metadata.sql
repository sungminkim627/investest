alter table public.instruments
  add column if not exists long_business_summary text,
  add column if not exists market_cap numeric,
  add column if not exists forward_pe numeric,
  add column if not exists trailing_pe numeric,
  add column if not exists beta numeric,
  add column if not exists debt_to_equity numeric,
  add column if not exists return_on_equity numeric,
  add column if not exists total_revenue numeric,
  add column if not exists net_income_to_common numeric,
  add column if not exists dividend_yield numeric,
  add column if not exists year_change_1y numeric,
  add column if not exists year_change_3y numeric,
  add column if not exists year_change_5y numeric,
  add column if not exists year_change_10y numeric;

