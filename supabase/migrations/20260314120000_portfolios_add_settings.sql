alter table public.portfolios
  add column if not exists start_value numeric,
  add column if not exists contribution_amount numeric,
  add column if not exists contribution_frequency text,
  add column if not exists rebalance_frequency text;

