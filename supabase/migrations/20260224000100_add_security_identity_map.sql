begin;

create table if not exists public.security_identity_map (
  id uuid primary key default gen_random_uuid(),
  cusip text not null,
  ticker text not null,
  source text not null,
  source_version text not null,
  confidence numeric(3,2) not null default 1.00,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint security_identity_map_cusip_format check (cusip ~ '^[A-Z0-9]{8,9}$'),
  constraint security_identity_map_ticker_format check (ticker ~ '^[A-Z.]{1,10}$'),
  constraint security_identity_map_confidence_bounds check (confidence >= 0 and confidence <= 1)
);

create unique index if not exists security_identity_map_active_cusip_idx
  on public.security_identity_map (cusip)
  where is_active = true;

create index if not exists security_identity_map_active_ticker_idx
  on public.security_identity_map (ticker)
  where is_active = true;

create index if not exists security_identity_map_effective_idx
  on public.security_identity_map (effective_from desc, effective_to);

alter table public.security_identity_map enable row level security;

comment on table public.security_identity_map is 'CUSIP-to-ticker identity mapping with versioned provenance and active-row semantics.';

commit;
