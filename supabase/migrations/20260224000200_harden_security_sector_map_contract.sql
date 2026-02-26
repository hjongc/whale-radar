begin;

alter table public.security_sector_map
  add column if not exists source_version text;

update public.security_sector_map
set source_version = coalesce(nullif(trim(source), ''), 'legacy') || '-v1'
where source_version is null or nullif(trim(source_version), '') is null;

update public.security_sector_map
set
  sector_code = case
    when upper(coalesce(sector_label, '')) = 'ENERGY' then '10'
    when upper(coalesce(sector_label, '')) = 'MATERIALS' then '15'
    when upper(coalesce(sector_label, '')) = 'INDUSTRIALS' then '20'
    when upper(coalesce(sector_label, '')) = 'CONSUMER DISCRETIONARY' then '25'
    when upper(coalesce(sector_label, '')) = 'CONSUMER STAPLES' then '30'
    when upper(coalesce(sector_label, '')) = 'HEALTH CARE' then '35'
    when upper(coalesce(sector_label, '')) = 'FINANCIALS' then '40'
    when upper(coalesce(sector_label, '')) = 'INFORMATION TECHNOLOGY' then '45'
    when upper(coalesce(sector_label, '')) = 'COMMUNICATION SERVICES' then '50'
    when upper(coalesce(sector_label, '')) = 'UTILITIES' then '55'
    when upper(coalesce(sector_label, '')) = 'REAL ESTATE' then '60'
    else sector_code
  end
where is_active = true;

update public.security_sector_map
set is_active = false,
    updated_at = timezone('utc', now())
where is_active = true
  and not (
    (sector_code = '10' and sector_label = 'Energy')
    or (sector_code = '15' and sector_label = 'Materials')
    or (sector_code = '20' and sector_label = 'Industrials')
    or (sector_code = '25' and sector_label = 'Consumer Discretionary')
    or (sector_code = '30' and sector_label = 'Consumer Staples')
    or (sector_code = '35' and sector_label = 'Health Care')
    or (sector_code = '40' and sector_label = 'Financials')
    or (sector_code = '45' and sector_label = 'Information Technology')
    or (sector_code = '50' and sector_label = 'Communication Services')
    or (sector_code = '55' and sector_label = 'Utilities')
    or (sector_code = '60' and sector_label = 'Real Estate')
  );

alter table public.security_sector_map
  alter column source_version set not null;

alter table public.security_sector_map
  add constraint security_sector_map_source_version_present
  check (nullif(trim(source_version), '') is not null);

alter table public.security_sector_map
  add constraint security_sector_map_active_gics_pair_check
  check (
    is_active = false
    or (
      (sector_code = '10' and sector_label = 'Energy')
      or (sector_code = '15' and sector_label = 'Materials')
      or (sector_code = '20' and sector_label = 'Industrials')
      or (sector_code = '25' and sector_label = 'Consumer Discretionary')
      or (sector_code = '30' and sector_label = 'Consumer Staples')
      or (sector_code = '35' and sector_label = 'Health Care')
      or (sector_code = '40' and sector_label = 'Financials')
      or (sector_code = '45' and sector_label = 'Information Technology')
      or (sector_code = '50' and sector_label = 'Communication Services')
      or (sector_code = '55' and sector_label = 'Utilities')
      or (sector_code = '60' and sector_label = 'Real Estate')
    )
  );

commit;
