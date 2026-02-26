begin;

create table if not exists public.whale_manager_directory_snapshot (
  manager_id text primary key,
  manager_name text not null,
  institution_name text not null,
  representative_manager text not null,
  report_period date not null,
  latest_filing_date date not null,
  holdings_count integer not null,
  total_value_usd_thousands numeric(20, 2) not null,
  rank integer not null,
  stale boolean not null,
  snapshot_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists whale_manager_directory_snapshot_rank_idx
  on public.whale_manager_directory_snapshot (rank asc, manager_name asc);

create table if not exists public.whale_manager_holdings_snapshot (
  manager_id text not null,
  manager_name text not null,
  report_period date not null,
  accession text not null,
  ticker text not null,
  issuer_name text not null,
  action_type text not null check (action_type in ('NEW', 'ADD', 'REDUCE', 'KEEP')),
  value_usd_thousands numeric(18, 2) not null,
  shares numeric(20, 4) not null,
  weight_pct numeric(12, 6) not null,
  cost numeric(18, 6) not null,
  price numeric(18, 6) not null,
  gap_pct numeric(12, 6) not null,
  price_timestamp timestamptz not null,
  source text not null,
  calc_version text not null,
  freshness text not null check (freshness in ('fresh', 'stale')),
  stale_reason text,
  snapshot_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (manager_id, ticker)
);

create index if not exists whale_manager_holdings_snapshot_manager_weight_idx
  on public.whale_manager_holdings_snapshot (manager_id, weight_pct desc, ticker asc);

alter table public.whale_manager_directory_snapshot enable row level security;
alter table public.whale_manager_holdings_snapshot enable row level security;

create or replace function public.refresh_whale_snapshot_tables()
returns jsonb
language plpgsql
as $$
declare
  now_utc timestamptz := timezone('utc', now());
  holdings_rows integer := 0;
  directory_rows integer := 0;
begin
  truncate table public.whale_manager_holdings_snapshot;
  truncate table public.whale_manager_directory_snapshot;

  with latest_filings as (
    select
      i.id as institution_id,
      i.cik,
      i.institution_name,
      f.id as filing_id,
      f.accession_number,
      f.filing_date,
      f.report_period,
      row_number() over (
        partition by i.id
        order by f.report_period desc, f.filing_date desc, f.accession_number desc
      ) as filing_rank
    from public.institutions i
    join public.filings f on f.institution_id = i.id
    where f.filing_form_type in ('13F-HR', '13F-HR/A')
  ),
  latest as (
    select *
    from latest_filings
    where filing_rank = 1
  ),
  previous as (
    select
      l.institution_id,
      p.filing_id,
      p.report_period
    from latest l
    left join lateral (
      select
        f.id as filing_id,
        f.report_period
      from public.filings f
      where f.institution_id = l.institution_id
        and f.filing_form_type in ('13F-HR', '13F-HR/A')
        and f.report_period < l.report_period
      order by f.report_period desc, f.filing_date desc, f.accession_number desc
      limit 1
    ) p on true
  ),
  latest_positions as (
    select
      l.institution_id,
      l.cik,
      l.institution_name,
      l.report_period,
      l.filing_date,
      l.accession_number,
      upper(coalesce(nullif(p.ticker, ''), identity_map.ticker)) as ticker,
      max(p.issuer_name) as issuer_name,
      sum(p.value_usd_thousands)::numeric(18, 2) as value_usd_thousands,
      sum(p.shares)::numeric(20, 4) as shares
    from latest l
    join public.positions p on p.filing_id = l.filing_id
    left join public.security_identity_map identity_map
      on identity_map.is_active = true
      and identity_map.cusip = p.cusip
    where p.value_usd_thousands > 0
      and p.shares > 0
    group by
      l.institution_id,
      l.cik,
      l.institution_name,
      l.report_period,
      l.filing_date,
      l.accession_number,
      upper(coalesce(nullif(p.ticker, ''), identity_map.ticker))
  ),
  previous_positions as (
    select
      p.institution_id,
      upper(coalesce(nullif(pos.ticker, ''), identity_map.ticker)) as ticker,
      sum(pos.value_usd_thousands)::numeric(18, 2) as value_usd_thousands,
      sum(pos.shares)::numeric(20, 4) as shares
    from previous p
    join public.positions pos on pos.filing_id = p.filing_id
    left join public.security_identity_map identity_map
      on identity_map.is_active = true
      and identity_map.cusip = pos.cusip
    where pos.value_usd_thousands > 0
      and pos.shares > 0
    group by p.institution_id, upper(coalesce(nullif(pos.ticker, ''), identity_map.ticker))
  ),
  normalized as (
    select
      lp.institution_id,
      concat('cik-', lp.cik) as manager_id,
      lp.institution_name as manager_name,
      lp.report_period,
      lp.filing_date,
      lp.accession_number,
      lp.ticker,
      lp.issuer_name,
      lp.value_usd_thousands,
      lp.shares,
      pp.value_usd_thousands as previous_value_usd_thousands,
      pp.shares as previous_shares
    from latest_positions lp
    left join previous_positions pp
      on pp.institution_id = lp.institution_id
      and pp.ticker = lp.ticker
    where lp.ticker is not null
      and lp.ticker ~ '^[A-Z.]{1,10}$'
  ),
  manager_totals as (
    select
      manager_id,
      manager_name,
      report_period,
      filing_date,
      count(*)::integer as holdings_count,
      sum(value_usd_thousands)::numeric(20, 2) as total_value_usd_thousands
    from normalized
    group by manager_id, manager_name, report_period, filing_date
  ),
  ranked_managers as (
    select
      manager_id,
      manager_name,
      report_period,
      filing_date,
      holdings_count,
      total_value_usd_thousands,
      row_number() over (
        order by total_value_usd_thousands desc, manager_name asc, manager_id asc
      ) as manager_rank
    from manager_totals
  ),
  top_managers as (
    select *
    from ranked_managers
    where manager_rank <= 50
  ),
  computed_holdings as (
    select
      n.manager_id,
      n.manager_name,
      n.report_period,
      n.accession_number,
      n.ticker,
      n.issuer_name,
      case
        when n.previous_value_usd_thousands is null then 'NEW'
        when n.value_usd_thousands > n.previous_value_usd_thousands * 1.03 then 'ADD'
        when n.value_usd_thousands < n.previous_value_usd_thousands * 0.97 then 'REDUCE'
        else 'KEEP'
      end as action_type,
      n.value_usd_thousands,
      n.shares,
      case
        when tm.total_value_usd_thousands > 0
          then round((n.value_usd_thousands / tm.total_value_usd_thousands) * 100, 6)
        else 0
      end as weight_pct,
      case
        when coalesce(n.previous_shares, 0) > 0 and coalesce(n.previous_value_usd_thousands, 0) > 0
          then round((n.previous_value_usd_thousands * 1000) / n.previous_shares, 6)
        when n.shares > 0
          then round((n.value_usd_thousands * 1000) / n.shares, 6)
        else 0
      end as cost,
      case
        when n.shares > 0
          then round((n.value_usd_thousands * 1000) / n.shares, 6)
        else 0
      end as price,
      case
        when coalesce(n.previous_shares, 0) > 0 and coalesce(n.previous_value_usd_thousands, 0) > 0 and n.shares > 0
          then round(
            (
              ((n.value_usd_thousands * 1000) / n.shares)
              - ((n.previous_value_usd_thousands * 1000) / n.previous_shares)
            )
            / ((n.previous_value_usd_thousands * 1000) / n.previous_shares),
            6
          )
        else 0
      end as gap_pct,
      (n.filing_date::text || 'T00:00:00.000Z')::timestamptz as price_timestamp,
      'snapshot'::text as source,
      'whale-snapshot-v1'::text as calc_version,
      case
        when n.report_period < (current_date - interval '220 days') then 'stale'
        else 'fresh'
      end as freshness,
      case
        when n.report_period < (current_date - interval '220 days') then 'report_period_stale'
        else null
      end as stale_reason
    from normalized n
    join top_managers tm on tm.manager_id = n.manager_id
  ),
  inserted_holdings as (
    insert into public.whale_manager_holdings_snapshot (
      manager_id,
      manager_name,
      report_period,
      accession,
      ticker,
      issuer_name,
      action_type,
      value_usd_thousands,
      shares,
      weight_pct,
      cost,
      price,
      gap_pct,
      price_timestamp,
      source,
      calc_version,
      freshness,
      stale_reason,
      snapshot_at,
      updated_at
    )
    select
      manager_id,
      manager_name,
      report_period,
      accession_number,
      ticker,
      issuer_name,
      action_type,
      value_usd_thousands,
      shares,
      weight_pct,
      cost,
      price,
      gap_pct,
      price_timestamp,
      source,
      calc_version,
      freshness,
      stale_reason,
      now_utc,
      now_utc
    from computed_holdings
    order by manager_id, weight_pct desc, ticker asc
    returning 1
  ),
  inserted_directory as (
    insert into public.whale_manager_directory_snapshot (
      manager_id,
      manager_name,
      institution_name,
      representative_manager,
      report_period,
      latest_filing_date,
      holdings_count,
      total_value_usd_thousands,
      rank,
      stale,
      snapshot_at,
      updated_at
    )
    select
      manager_id,
      manager_name,
      manager_name,
      manager_name,
      report_period,
      filing_date,
      holdings_count,
      total_value_usd_thousands,
      manager_rank,
      report_period < (current_date - interval '220 days'),
      now_utc,
      now_utc
    from top_managers
    order by manager_rank asc
    returning 1
  )
  select
    (select count(*) from inserted_holdings),
    (select count(*) from inserted_directory)
  into holdings_rows, directory_rows;

  return jsonb_build_object(
    'holdings_rows', holdings_rows,
    'directory_rows', directory_rows,
    'refreshed_at', now_utc
  );
end;
$$;

comment on function public.refresh_whale_snapshot_tables() is
  'Recomputes whale manager directory and holdings snapshots from latest/previous 13F filings.';

commit;
