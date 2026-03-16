alter table public.instruments
  drop column if exists year_change_3y,
  drop column if exists year_change_5y,
  drop column if exists year_change_10y;

