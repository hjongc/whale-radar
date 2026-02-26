with gics_pairs as (
  select '10'::text as sector_code, 'Energy'::text as sector_label union all
  select '15', 'Materials' union all
  select '20', 'Industrials' union all
  select '25', 'Consumer Discretionary' union all
  select '30', 'Consumer Staples' union all
  select '35', 'Health Care' union all
  select '40', 'Financials' union all
  select '45', 'Information Technology' union all
  select '50', 'Communication Services' union all
  select '55', 'Utilities' union all
  select '60', 'Real Estate'
), canonical_latest as (
  select
    f.institution_id,
    f.id as filing_id,
    f.report_period,
    f.filing_date,
    row_number() over (
      partition by f.institution_id
      order by f.report_period desc, f.filing_date desc, f.accession_number desc
    ) as rn
  from public.filings f
  where f.filing_form_type in ('13F-HR', '13F-HR/A')
), latest_holdings as (
  select
    cl.institution_id,
    cl.filing_id,
    p.cusip,
    p.ticker,
    p.value_usd_thousands,
    p.shares
  from canonical_latest cl
  join public.positions p on p.filing_id = cl.filing_id
  where cl.rn = 1
), ranked_institutions as (
  select
    i.id as institution_id,
    i.institution_name,
    sum(case when lh.value_usd_thousands > 0 and lh.shares > 0 then lh.value_usd_thousands else 0 end) as latest_value_usd_thousands,
    row_number() over (
      order by
        sum(case when lh.value_usd_thousands > 0 and lh.shares > 0 then lh.value_usd_thousands else 0 end) desc,
        i.institution_name asc,
        i.id asc
    ) as canonical_rank
  from public.institutions i
  join latest_holdings lh on lh.institution_id = i.id
  group by i.id, i.institution_name
), top50 as (
  select institution_id, institution_name, canonical_rank
  from ranked_institutions
  where canonical_rank <= 50
), top50_holdings as (
  select lh.*
  from latest_holdings lh
  join top50 t on t.institution_id = lh.institution_id
), top50_with_ticker as (
  select
    h.*,
    coalesce(
      nullif(upper(trim(h.ticker)), ''),
      sim.ticker
    ) as resolved_ticker
  from top50_holdings h
  left join public.security_identity_map sim
    on sim.cusip = upper(trim(h.cusip))
   and sim.is_active = true
), top50_with_sector as (
  select
    h.*,
    coalesce(ssm_cusip.sector_label, ssm_ticker.sector_label, 'Unknown') as sector_label
  from top50_with_ticker h
  left join public.security_sector_map ssm_cusip
    on ssm_cusip.cusip = upper(trim(h.cusip))
   and ssm_cusip.is_active = true
   and exists (
     select 1
     from gics_pairs gp
     where gp.sector_code = ssm_cusip.sector_code
       and gp.sector_label = ssm_cusip.sector_label
   )
  left join public.security_sector_map ssm_ticker
    on ssm_ticker.ticker = h.resolved_ticker
   and ssm_ticker.is_active = true
   and exists (
     select 1
     from gics_pairs gp
     where gp.sector_code = ssm_ticker.sector_code
       and gp.sector_label = ssm_ticker.sector_label
   )
), active_identity as (
  select *
  from public.security_identity_map
  where is_active = true
), active_sector as (
  select *
  from public.security_sector_map
  where is_active = true
)
select
  'top50_institution_count' as metric,
  count(*)::text as value,
  'target=50' as target
from top50
union all
select
  'top50_ticker_missing_rate_pct' as metric,
  round(100.0 * avg(case when resolved_ticker is null then 1 else 0 end), 2)::text as value,
  'target<=20' as target
from top50_with_ticker
union all
select
  'top50_sector_coverage_pct' as metric,
  round(100.0 * avg(case when sector_label not in ('Unknown', 'Unclassified') then 1 else 0 end), 2)::text as value,
  'target>=80' as target
from top50_with_sector
union all
select
  'top50_unknown_sector_ratio_pct' as metric,
  round(100.0 * avg(case when sector_label in ('Unknown', 'Unclassified') then 1 else 0 end), 2)::text as value,
  'target<=15' as target
from top50_with_sector
union all
select
  'non_positive_holding_rows' as metric,
  count(*)::text as value,
  'target=0' as target
from top50_holdings
where value_usd_thousands <= 0 or shares <= 0
union all
select
  'identity_missing_source_version_rows' as metric,
  count(*)::text as value,
  'target=0' as target
from active_identity
where nullif(trim(source_version), '') is null
union all
select
  'sector_missing_source_version_rows' as metric,
  count(*)::text as value,
  'target=0' as target
from active_sector
where nullif(trim(source_version), '') is null
union all
select
  'identity_stale_rows_24h' as metric,
  count(*)::text as value,
  'target=0' as target
from active_identity
where updated_at < timezone('utc', now()) - interval '24 hours'
union all
select
  'sector_stale_rows_24h' as metric,
  count(*)::text as value,
  'target=0' as target
from active_sector
where updated_at < timezone('utc', now()) - interval '24 hours';
