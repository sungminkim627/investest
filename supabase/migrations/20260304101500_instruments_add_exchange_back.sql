alter table public.instruments
  add column if not exists exchange text;

create index if not exists instruments_exchange_idx
  on public.instruments(exchange);
