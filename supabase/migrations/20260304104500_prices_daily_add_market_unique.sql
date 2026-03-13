alter table public.prices_daily
  add column if not exists market text;

update public.prices_daily p
set market = i.market
from public.instruments i
where p.symbol = i.symbol
  and (p.market is null or p.market = '');

update public.prices_daily
set market = 'US'
where market is null or market = '';

alter table public.prices_daily
  alter column market set not null;

alter table public.prices_daily
  drop constraint if exists prices_daily_symbol_date_key;

create unique index if not exists prices_daily_symbol_market_date_key
  on public.prices_daily(symbol, market, date);

drop index if exists prices_daily_symbol_idx;
create index if not exists prices_daily_symbol_market_idx
  on public.prices_daily(symbol, market);
