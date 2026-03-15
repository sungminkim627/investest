drop index if exists public.instruments_valuation_idx;
alter table public.instruments drop column if exists valuation;
