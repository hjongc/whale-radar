begin;

create extension if not exists pgcrypto;

create type public.filing_form_type as enum (
  '13F-HR',
  '13F-HR/A',
  '13F-NT',
  '13F-NT/A'
);

create type public.run_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'replayed'
);

create type public.run_kind as enum (
  'discovery',
  'filing_fetch',
  'parse',
  'enrichment',
  'aggregate'
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  cik text not null unique,
  institution_name text not null,
  lei text,
  country_code text,
  is_priority_cohort boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint institutions_cik_format check (cik ~ '^[0-9]{10}$'),
  constraint institutions_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

create table public.filings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  accession_number text not null,
  filing_form_type public.filing_form_type not null,
  filing_date date not null,
  report_period date not null,
  filed_at timestamptz,
  acceptance_datetime timestamptz,
  filing_manager_name text,
  filing_manager_cik text,
  is_amendment boolean not null default false,
  is_notice boolean not null default false,
  amends_accession_number text,
  supersedes_filing_id uuid references public.filings(id) on delete set null,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint filings_accession_unique unique (accession_number),
  constraint filings_accession_format check (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint filings_manager_cik_format check (filing_manager_cik is null or filing_manager_cik ~ '^[0-9]{10}$'),
  constraint filings_amendment_flag_consistency check (
    (filing_form_type in ('13F-HR/A', '13F-NT/A')) = is_amendment
  ),
  constraint filings_notice_flag_consistency check (
    (filing_form_type in ('13F-NT', '13F-NT/A')) = is_notice
  ),
  constraint filings_amendment_lineage check (
    (is_amendment = false and amends_accession_number is null)
    or
    (is_amendment = true and amends_accession_number is not null)
  )
);

create index filings_institution_report_idx on public.filings (institution_id, report_period desc);
create index filings_form_type_idx on public.filings (filing_form_type, filing_date desc);
create index filings_amends_accession_idx on public.filings (amends_accession_number);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references public.filings(id) on delete cascade,
  row_number integer not null,
  issuer_name text not null,
  class_title text,
  cusip text not null,
  ticker text,
  value_usd_thousands numeric(18, 2) not null,
  shares numeric(20, 4) not null,
  share_type text,
  put_call text,
  investment_discretion text,
  voting_sole bigint not null default 0,
  voting_shared bigint not null default 0,
  voting_none bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint positions_row_unique unique (filing_id, row_number),
  constraint positions_cusip_format check (cusip ~ '^[A-Z0-9]{8,9}$'),
  constraint positions_positive_value check (value_usd_thousands >= 0),
  constraint positions_positive_shares check (shares >= 0),
  constraint positions_put_call_values check (put_call is null or put_call in ('PUT', 'CALL')),
  constraint positions_ticker_format check (ticker is null or ticker ~ '^[A-Z.]{1,10}$')
);

create index positions_filing_idx on public.positions (filing_id);
create index positions_ticker_idx on public.positions (ticker);
create index positions_cusip_idx on public.positions (cusip);

create table public.price_bars (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  bar_date date not null,
  timeframe text not null default '1d',
  open numeric(18, 6) not null,
  high numeric(18, 6) not null,
  low numeric(18, 6) not null,
  close numeric(18, 6) not null,
  adjusted_close numeric(18, 6),
  volume bigint not null,
  source text not null default 'yahoo',
  source_timestamp timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint price_bars_unique unique (symbol, bar_date, timeframe, source),
  constraint price_bars_symbol_format check (symbol ~ '^[A-Z.]{1,10}$'),
  constraint price_bars_positive_values check (
    open >= 0 and high >= 0 and low >= 0 and close >= 0
    and high >= low
    and high >= open
    and high >= close
    and low <= open
    and low <= close
  ),
  constraint price_bars_volume_non_negative check (volume >= 0)
);

create index price_bars_symbol_date_idx on public.price_bars (symbol, bar_date desc);

create table public.derived_metrics (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references public.filings(id) on delete cascade,
  position_id uuid references public.positions(id) on delete cascade,
  price_bar_id uuid references public.price_bars(id) on delete set null,
  metric_version text not null,
  inferred_cost_basis numeric(18, 6),
  current_price numeric(18, 6),
  gap_pct numeric(10, 6),
  price_timestamp timestamptz not null,
  is_stale boolean not null default false,
  source text not null,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint derived_metrics_unique unique (filing_id, position_id, metric_version, price_timestamp),
  constraint derived_metrics_price_non_negative check (
    inferred_cost_basis is null or inferred_cost_basis >= 0
  ),
  constraint derived_metrics_current_non_negative check (
    current_price is null or current_price >= 0
  ),
  constraint derived_metrics_gap_bounds check (gap_pct is null or gap_pct between -10 and 10)
);

create index derived_metrics_filing_idx on public.derived_metrics (filing_id);
create index derived_metrics_position_idx on public.derived_metrics (position_id);
create index derived_metrics_stale_idx on public.derived_metrics (is_stale, price_timestamp desc);

create table public.run_ledger (
  id uuid primary key default gen_random_uuid(),
  run_kind public.run_kind not null,
  run_status public.run_status not null,
  trigger_mode text not null,
  request_signature text not null,
  target_institution_id uuid references public.institutions(id) on delete set null,
  target_accession_number text,
  parser_version text,
  transform_version text,
  input_payload jsonb not null default '{}'::jsonb,
  row_counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_payload jsonb,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint run_ledger_accession_format check (
    target_accession_number is null
    or target_accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
  ),
  constraint run_ledger_end_after_start check (ended_at is null or ended_at >= started_at)
);

create unique index run_ledger_idempotency_unique_idx
  on public.run_ledger (run_kind, request_signature, coalesce(target_accession_number, 'GLOBAL'));
create index run_ledger_status_started_idx on public.run_ledger (run_status, started_at desc);
create index run_ledger_accession_idx on public.run_ledger (target_accession_number);

alter table public.institutions enable row level security;
alter table public.filings enable row level security;
alter table public.positions enable row level security;
alter table public.price_bars enable row level security;
alter table public.derived_metrics enable row level security;
alter table public.run_ledger enable row level security;

comment on table public.run_ledger is 'Replay-safe run ledger keyed by run_kind + request_signature + accession.';
comment on table public.filings is '13F filings with explicit HR/NT + amendment lineage semantics.';

commit;
