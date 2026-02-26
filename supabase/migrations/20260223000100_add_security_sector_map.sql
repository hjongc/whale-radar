begin;

create table if not exists public.security_sector_map (
  id uuid primary key default gen_random_uuid(),
  cusip text,
  ticker text,
  sector_code text not null,
  sector_label text not null,
  source text not null default 'manual',
  confidence numeric(3,2) not null default 1.00,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint security_sector_map_identity_check check (cusip is not null or ticker is not null),
  constraint security_sector_map_cusip_format check (cusip is null or cusip ~ '^[A-Z0-9]{8,9}$'),
  constraint security_sector_map_ticker_format check (ticker is null or ticker ~ '^[A-Z.]{1,10}$'),
  constraint security_sector_map_confidence_bounds check (confidence >= 0 and confidence <= 1)
);

create unique index if not exists security_sector_map_active_cusip_idx
  on public.security_sector_map (cusip)
  where cusip is not null and is_active = true;

create unique index if not exists security_sector_map_active_ticker_idx
  on public.security_sector_map (ticker)
  where ticker is not null and is_active = true;

create index if not exists security_sector_map_sector_idx
  on public.security_sector_map (sector_code, sector_label);

alter table public.security_sector_map enable row level security;

comment on table public.security_sector_map is 'Security-to-sector mapping with provenance and confidence for aggregate sector analytics.';

commit;
