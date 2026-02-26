begin;

create or replace function public.gics11_sector_for_security(ticker_input text, issuer_input text)
returns table(sector_code text, sector_label text, confidence numeric)
language sql
as $$
  with normalized as (
    select
      upper(coalesce(ticker_input, '')) as ticker,
      lower(coalesce(issuer_input, '')) as issuer
  )
  select
    case
      when ticker in ('SPY','IVV','VOO','VTI','IWM','DIA','QQQ','TLT','BND','AGG','HYG','EFA','EEM','VEA','VWO','IXUS','IWF','IWD','IJR','IJH','ITOT') then 'MARKET_ETF'
      when ticker in ('XLK','SMH','SOXX') then 'INFO_TECH'
      when ticker in ('XLF','KRE') then 'FINANCIALS'
      when ticker in ('XLV','XBI') then 'HEALTH_CARE'
      when ticker in ('XLE') then 'ENERGY'
      when ticker in ('XLC') then 'COMM_SERV'
      when ticker in ('XLY') then 'CONSUMER_DISC'
      when ticker in ('XLP') then 'CONSUMER_STAP'
      when ticker in ('XLI') then 'INDUSTRIALS'
      when ticker in ('XLB') then 'MATERIALS'
      when ticker in ('XLU') then 'UTILITIES'
      when ticker in ('XLRE','VNQ','IYR','SCHH') then 'REAL_ESTATE'
      when ticker ~ '\\.(TO|SW|L|DE|MI|TA|AS|MX)$' then 'MARKET_ETF'
      when issuer ~ '(etf|index fund|trust etf|spdr|ishares|vanguard index)' then 'MARKET_ETF'
      when issuer ~ '(software|semiconductor|technology|technologies|cloud|systems|micro devices|micro computer|data processing|network)' then 'INFO_TECH'
      when issuer ~ '(bank|financial|capital|insurance|payments|credit|asset management|trust|investment)' then 'FINANCIALS'
      when issuer ~ '(health|pharma|therapeutic|biotech|medical|laboratories|diagnostics|hospital|life sciences)' then 'HEALTH_CARE'
      when issuer ~ '(energy|petroleum|oil|gas|drilling|exploration|midstream|refining)' then 'ENERGY'
      when issuer ~ '(communication|telecom|wireless|media|stream|entertainment|internet|interactive)' then 'COMM_SERV'
      when issuer ~ '(retail|restaurant|apparel|motors|automotive|airline|travel|leisure|hotel|e-?commerce)' then 'CONSUMER_DISC'
      when issuer ~ '(food|beverage|household|grocery|supermarket|tobacco)' then 'CONSUMER_STAP'
      when issuer ~ '(industrial|aerospace|defense|machinery|rail|transport|logistics|construction)' then 'INDUSTRIALS'
      when issuer ~ '(materials|chemic|mining|steel|aluminum|paper|packaging)' then 'MATERIALS'
      when issuer ~ '(utility|electric|water utility|power generation|energy delivery)' then 'UTILITIES'
      when issuer ~ '(real estate|reit|property|properties|self-storage|apartment)' then 'REAL_ESTATE'
      else 'UNKNOWN'
    end as sector_code,
    case
      when ticker in ('SPY','IVV','VOO','VTI','IWM','DIA','QQQ','TLT','BND','AGG','HYG','EFA','EEM','VEA','VWO','IXUS','IWF','IWD','IJR','IJH','ITOT') then 'Market ETF'
      when ticker in ('XLK','SMH','SOXX') or issuer ~ '(software|semiconductor|technology|technologies|cloud|systems|micro devices|micro computer|data processing|network)' then 'Information Technology'
      when ticker in ('XLF','KRE') or issuer ~ '(bank|financial|capital|insurance|payments|credit|asset management|trust|investment)' then 'Financials'
      when ticker in ('XLV','XBI') or issuer ~ '(health|pharma|therapeutic|biotech|medical|laboratories|diagnostics|hospital|life sciences)' then 'Health Care'
      when ticker in ('XLE') or issuer ~ '(energy|petroleum|oil|gas|drilling|exploration|midstream|refining)' then 'Energy'
      when ticker in ('XLC') or issuer ~ '(communication|telecom|wireless|media|stream|entertainment|internet|interactive)' then 'Communication Services'
      when ticker in ('XLY') or issuer ~ '(retail|restaurant|apparel|motors|automotive|airline|travel|leisure|hotel|e-?commerce)' then 'Consumer Discretionary'
      when ticker in ('XLP') or issuer ~ '(food|beverage|household|grocery|supermarket|tobacco)' then 'Consumer Staples'
      when ticker in ('XLI') or issuer ~ '(industrial|aerospace|defense|machinery|rail|transport|logistics|construction)' then 'Industrials'
      when ticker in ('XLB') or issuer ~ '(materials|chemic|mining|steel|aluminum|paper|packaging)' then 'Materials'
      when ticker in ('XLU') or issuer ~ '(utility|electric|water utility|power generation|energy delivery)' then 'Utilities'
      when ticker in ('XLRE','VNQ','IYR','SCHH') or issuer ~ '(real estate|reit|property|properties|self-storage|apartment)' then 'Real Estate'
      when ticker ~ '\\.(TO|SW|L|DE|MI|TA|AS|MX)$' or issuer ~ '(etf|index fund|trust etf|spdr|ishares|vanguard index)' then 'Market ETF'
      else 'Unknown'
    end as sector_label,
    case
      when ticker in ('SPY','IVV','VOO','VTI','IWM','DIA','QQQ','TLT','BND','AGG','HYG','EFA','EEM','VEA','VWO','IXUS','IWF','IWD','IJR','IJH','ITOT') then 0.90
      when ticker in ('XLK','SMH','SOXX','XLF','KRE','XLV','XBI','XLE','XLC','XLY','XLP','XLI','XLB','XLU','XLRE','VNQ','IYR','SCHH') then 0.90
      when ticker ~ '\\.(TO|SW|L|DE|MI|TA|AS|MX)$' then 0.55
      when issuer ~ '(software|semiconductor|technology|technologies|cloud|systems|micro devices|micro computer|data processing|network|bank|financial|capital|insurance|payments|credit|asset management|trust|investment|health|pharma|therapeutic|biotech|medical|laboratories|diagnostics|hospital|life sciences|energy|petroleum|oil|gas|drilling|exploration|midstream|refining|communication|telecom|wireless|media|stream|entertainment|internet|interactive|retail|restaurant|apparel|motors|automotive|airline|travel|leisure|hotel|e-?commerce|food|beverage|household|grocery|supermarket|tobacco|industrial|aerospace|defense|machinery|rail|transport|logistics|construction|materials|chemic|mining|steel|aluminum|paper|packaging|utility|electric|water utility|power generation|energy delivery|real estate|reit|property|properties|self-storage|apartment)' then 0.72
      else 0.25
    end::numeric(3,2) as confidence
  from normalized;
$$;

create or replace function public.refresh_security_sector_map_from_positions()
returns table(updated_rows bigint, inserted_rows bigint)
language plpgsql
as $$
declare
  v_updated bigint := 0;
  v_inserted bigint := 0;
begin
  with ticker_profiles as (
    select
      upper(p.ticker) as ticker,
      lower(max(p.issuer_name)) as issuer_name
    from public.positions p
    where p.ticker is not null
    group by upper(p.ticker)
  ), classified as (
    select
      tp.ticker,
      mapped.sector_code,
      mapped.sector_label,
      mapped.confidence
    from ticker_profiles tp
    cross join lateral public.gics11_sector_for_security(tp.ticker, tp.issuer_name) mapped
  ), updated as (
    update public.security_sector_map s
    set
      sector_code = c.sector_code,
      sector_label = c.sector_label,
      source = 'db-auto-gics11-v1',
      confidence = c.confidence,
      updated_at = timezone('utc', now())
    from classified c
    where s.is_active = true and s.ticker = c.ticker
    returning s.ticker
  )
  select count(*) into v_updated from updated;

  with ticker_profiles as (
    select
      upper(p.ticker) as ticker,
      lower(max(p.issuer_name)) as issuer_name
    from public.positions p
    where p.ticker is not null
    group by upper(p.ticker)
  ), classified as (
    select
      tp.ticker,
      mapped.sector_code,
      mapped.sector_label,
      mapped.confidence
    from ticker_profiles tp
    cross join lateral public.gics11_sector_for_security(tp.ticker, tp.issuer_name) mapped
  ), inserted as (
    insert into public.security_sector_map (
      ticker,
      sector_code,
      sector_label,
      source,
      confidence,
      is_active
    )
    select
      c.ticker,
      c.sector_code,
      c.sector_label,
      'db-auto-gics11-v1',
      c.confidence,
      true
    from classified c
    where not exists (
      select 1 from public.security_sector_map s where s.is_active = true and s.ticker = c.ticker
    )
    returning ticker
  )
  select count(*) into v_inserted from inserted;

  return query select v_updated, v_inserted;
end;
$$;

comment on function public.gics11_sector_for_security(text, text) is 'Classify ticker/issuer to GICS11 or Market ETF/Unknown fallback.';
comment on function public.refresh_security_sector_map_from_positions() is 'DB-level refresh: map all distinct position tickers to GICS11 sectors.';

commit;
