alter table public.instruments
  add column if not exists short_description text,
  add column if not exists sector text,
  add column if not exists industry text,
  add column if not exists tags text[] not null default '{}';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instruments_short_description_len_chk'
  ) then
    alter table public.instruments
      add constraint instruments_short_description_len_chk
      check (short_description is null or char_length(short_description) <= 220);
  end if;
end $$;

create index if not exists instruments_short_description_trgm_idx
  on public.instruments using gin (short_description gin_trgm_ops);

create index if not exists instruments_sector_idx on public.instruments(sector);
create index if not exists instruments_industry_idx on public.instruments(industry);

alter table public.instruments
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(symbol, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(short_description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(asset_type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(sector, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(industry, '')), 'C')
  ) stored;

create index if not exists instruments_search_vector_idx
  on public.instruments using gin (search_vector);

drop trigger if exists instruments_set_updated_at on public.instruments;
create trigger instruments_set_updated_at
before update on public.instruments
for each row
execute function public.set_updated_at();
