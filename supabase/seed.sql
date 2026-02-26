begin;

insert into public.institutions (
  id,
  cik,
  institution_name,
  representative_manager,
  country_code,
  is_priority_cohort
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    '0001067983',
    'Berkshire Hathaway Inc.',
    'Warren Buffett',
    'US',
    true
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '0001166559',
    'Pershing Square Capital Management, L.P.',
    'Bill Ackman',
    'US',
    true
  ),
  (
    '9f0a6e7e-2b66-4e53-bd68-2b5804e5e99a',
    '0001536411',
    'Duquesne Family Office LLC',
    'Stanley Druckenmiller',
    'US',
    true
  )
on conflict (cik) do update
set
  institution_name = excluded.institution_name,
  representative_manager = excluded.representative_manager,
  country_code = excluded.country_code,
  is_priority_cohort = excluded.is_priority_cohort,
  updated_at = timezone('utc', now());

insert into public.filings (
  id,
  institution_id,
  accession_number,
  filing_form_type,
  filing_date,
  report_period,
  filed_at,
  acceptance_datetime,
  filing_manager_name,
  filing_manager_cik,
  is_amendment,
  is_notice,
  amends_accession_number,
  raw_payload,
  source_url
)
values
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    '0001067983-24-000001',
    '13F-HR',
    '2024-02-14',
    '2023-12-31',
    '2024-02-14 18:10:00+00',
    '2024-02-14 18:10:30+00',
    'Berkshire Hathaway Inc.',
    '0001067983',
    false,
    false,
    null,
    '{"source":"seed","note":"original filing"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1067983/000106798324000001/'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '0001067983-24-000002',
    '13F-HR/A',
    '2024-03-01',
    '2023-12-31',
    '2024-03-01 12:30:00+00',
    '2024-03-01 12:30:10+00',
    'Berkshire Hathaway Inc.',
    '0001067983',
    true,
    false,
    '0001067983-24-000001',
    '{"source":"seed","note":"amendment filing"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1067983/000106798324000002/'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '22222222-2222-2222-2222-222222222222',
    '0001166559-24-000010',
    '13F-NT',
    '2024-02-15',
    '2023-12-31',
    '2024-02-15 14:30:00+00',
    '2024-02-15 14:30:20+00',
    'Pershing Square Capital Management, L.P.',
    '0001166559',
    false,
    true,
    null,
    '{"source":"seed","note":"notice-only filing"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1166559/000116655924000010/'
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    '22222222-2222-2222-2222-222222222222',
    '0001166559-24-000011',
    '13F-NT/A',
    '2024-03-03',
    '2023-12-31',
    '2024-03-03 09:21:00+00',
    '2024-03-03 09:21:11+00',
    'Pershing Square Capital Management, L.P.',
    '0001166559',
    true,
    true,
    '0001166559-24-000010',
    '{"source":"seed","note":"notice amendment"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1166559/000116655924000011/'
  ),
  (
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    '9f0a6e7e-2b66-4e53-bd68-2b5804e5e99a',
    '0001536411-26-000001',
    '13F-HR',
    '2026-02-14',
    '2025-12-31',
    '2026-02-14 18:10:00+00',
    '2026-02-14 18:10:30+00',
    'Duquesne Family Office LLC',
    '0001536411',
    false,
    false,
    null,
    '{"source":"seed","note":"duquesne baseline filing"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1536411/000153641126000001/'
  ),
  (
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    '9f0a6e7e-2b66-4e53-bd68-2b5804e5e99a',
    '0001536411-25-000009',
    '13F-HR',
    '2025-11-14',
    '2025-09-30',
    '2025-11-14 18:10:00+00',
    '2025-11-14 18:10:30+00',
    'Duquesne Family Office LLC',
    '0001536411',
    false,
    false,
    null,
    '{"source":"seed","note":"duquesne prior filing"}'::jsonb,
    'https://www.sec.gov/Archives/edgar/data/1536411/000153641125000009/'
  )
on conflict (accession_number) do update
set
  filing_form_type = excluded.filing_form_type,
  filing_date = excluded.filing_date,
  report_period = excluded.report_period,
  is_amendment = excluded.is_amendment,
  is_notice = excluded.is_notice,
  amends_accession_number = excluded.amends_accession_number,
  raw_payload = excluded.raw_payload,
  updated_at = timezone('utc', now());

update public.filings
set supersedes_filing_id = '33333333-3333-3333-3333-333333333333'
where id = '44444444-4444-4444-4444-444444444444';

update public.filings
set supersedes_filing_id = '55555555-5555-5555-5555-555555555555'
where id = '66666666-6666-6666-6666-666666666666';

insert into public.positions (
  id,
  filing_id,
  row_number,
  issuer_name,
  class_title,
  cusip,
  ticker,
  value_usd_thousands,
  shares,
  share_type,
  put_call,
  investment_discretion,
  voting_sole,
  voting_shared,
  voting_none
)
values
  (
    '77777777-7777-7777-7777-777777777777',
    '33333333-3333-3333-3333-333333333333',
    1,
    'Apple Inc.',
    'COM',
    '037833100',
    'AAPL',
    18500000.00,
    91500000.0000,
    'SH',
    null,
    'SOLE',
    90000000,
    1000000,
    500000
  ),
  (
    '88888888-8888-8888-8888-888888888888',
    '33333333-3333-3333-3333-333333333333',
    2,
    'Bank of America Corp',
    'COM',
    '060505104',
    'BAC',
    8700000.00,
    225000000.0000,
    'SH',
    null,
    'SOLE',
    220000000,
    3000000,
    2000000
  ),
  (
    '9aa8fa2e-4e3f-4d6f-b37e-fd88ad0de71f',
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    1,
    'NVIDIA Corp.',
    'COM',
    '67066G104',
    'NVDA',
    920000.00,
    6900000.0000,
    'SH',
    null,
    'SOLE',
    6900000,
    0,
    0
  ),
  (
    '6cdde9d4-f3eb-4184-a6f0-c65fd5da98f6',
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    2,
    'Amazon.com Inc.',
    'COM',
    '023135106',
    'AMZN',
    740000.00,
    3950000.0000,
    'SH',
    null,
    'SOLE',
    3950000,
    0,
    0
  ),
  (
    '092da3fc-5b23-4bf9-b3bb-f21cfac6e772',
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    3,
    'Microsoft Corp.',
    'COM',
    '594918104',
    'MSFT',
    610000.00,
    1550000.0000,
    'SH',
    null,
    'SOLE',
    1550000,
    0,
    0
  ),
  (
    '1c9afec7-7c18-405d-b0f1-500c6f3b5797',
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    4,
    'Meta Platforms Inc.',
    'COM',
    '30303M102',
    'META',
    410000.00,
    700000.0000,
    'SH',
    null,
    'SOLE',
    700000,
    0,
    0
  ),
  (
    '56b76a4e-6ec5-4f19-9f7b-8cfc4dcfc7fd',
    'a41011ea-87e4-4db1-b7ac-2d2d315f5b1f',
    5,
    'Apple Inc.',
    'COM',
    '037833100',
    'AAPL',
    360000.00,
    1800000.0000,
    'SH',
    null,
    'SOLE',
    1800000,
    0,
    0
  ),
  (
    'a166b656-52eb-4f10-a06b-86e613662058',
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    1,
    'NVIDIA Corp.',
    'COM',
    '67066G104',
    'NVDA',
    840000.00,
    7200000.0000,
    'SH',
    null,
    'SOLE',
    7200000,
    0,
    0
  ),
  (
    'd94c5ee8-ad2e-45f2-abbb-9eb2ed89f5cb',
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    2,
    'Amazon.com Inc.',
    'COM',
    '023135106',
    'AMZN',
    690000.00,
    4100000.0000,
    'SH',
    null,
    'SOLE',
    4100000,
    0,
    0
  ),
  (
    '24ffc5a2-c092-4a63-bd86-5ef80d7e77d4',
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    3,
    'Microsoft Corp.',
    'COM',
    '594918104',
    'MSFT',
    570000.00,
    1600000.0000,
    'SH',
    null,
    'SOLE',
    1600000,
    0,
    0
  ),
  (
    'ab4e9782-8534-4f88-ab61-26f29f4f6de5',
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    4,
    'Meta Platforms Inc.',
    'COM',
    '30303M102',
    'META',
    380000.00,
    710000.0000,
    'SH',
    null,
    'SOLE',
    710000,
    0,
    0
  ),
  (
    '1638bf80-79b8-4ed9-b131-4a46e37f1964',
    '4c836cae-21cf-41fd-9dc9-5cedf2adf7cc',
    5,
    'Apple Inc.',
    'COM',
    '037833100',
    'AAPL',
    335000.00,
    1850000.0000,
    'SH',
    null,
    'SOLE',
    1850000,
    0,
    0
  )
on conflict (filing_id, row_number) do update
set
  issuer_name = excluded.issuer_name,
  ticker = excluded.ticker,
  value_usd_thousands = excluded.value_usd_thousands,
  shares = excluded.shares,
  updated_at = timezone('utc', now());

insert into public.price_bars (
  id,
  symbol,
  bar_date,
  timeframe,
  open,
  high,
  low,
  close,
  adjusted_close,
  volume,
  source,
  source_timestamp
)
values
  (
    '99999999-9999-9999-9999-999999999999',
    'AAPL',
    '2024-02-14',
    '1d',
    183.50,
    186.20,
    182.40,
    185.95,
    185.95,
    51500000,
    'yahoo',
    '2024-02-14 21:00:00+00'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'BAC',
    '2024-02-14',
    '1d',
    32.10,
    32.80,
    31.95,
    32.60,
    32.60,
    39800000,
    'yahoo',
    '2024-02-14 21:00:00+00'
  )
on conflict (symbol, bar_date, timeframe, source) do update
set
  open = excluded.open,
  high = excluded.high,
  low = excluded.low,
  close = excluded.close,
  adjusted_close = excluded.adjusted_close,
  volume = excluded.volume,
  source_timestamp = excluded.source_timestamp,
  updated_at = timezone('utc', now());

insert into public.derived_metrics (
  id,
  filing_id,
  position_id,
  price_bar_id,
  metric_version,
  inferred_cost_basis,
  current_price,
  gap_pct,
  price_timestamp,
  is_stale,
  source,
  lineage
)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '33333333-3333-3333-3333-333333333333',
    '77777777-7777-7777-7777-777777777777',
    '99999999-9999-9999-9999-999999999999',
    'v1',
    171.45,
    185.95,
    0.0846,
    '2024-02-14 21:00:00+00',
    false,
    'yahoo',
    '{"accession_number":"0001067983-24-000001","price_bar_date":"2024-02-14","transform_version":"v1"}'::jsonb
  )
on conflict (filing_id, position_id, metric_version, price_timestamp) do update
set
  inferred_cost_basis = excluded.inferred_cost_basis,
  current_price = excluded.current_price,
  gap_pct = excluded.gap_pct,
  is_stale = excluded.is_stale,
  lineage = excluded.lineage,
  updated_at = timezone('utc', now());

insert into public.security_sector_map (
  id,
  cusip,
  ticker,
  sector_code,
  sector_label,
  source,
  source_version,
  confidence,
  is_active
)
values
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '037833100',
    'AAPL',
    '45',
    'Information Technology',
    'seed-manual',
    'seed-manual-v1',
    0.99,
    true
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '060505104',
    'BAC',
    '40',
    'Financials',
    'seed-manual',
    'seed-manual-v1',
    0.99,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    null,
    'GOOGL',
    '50',
    'Communication Services',
    'seed-manual',
    'seed-manual-v1',
    0.92,
    true
  ),
  (
    '12121212-1212-1212-1212-121212121212',
    null,
    'AMZN',
    '25',
    'Consumer Discretionary',
    'seed-manual',
    'seed-manual-v1',
    0.92,
    true
  )
on conflict do nothing;

insert into public.security_sector_map (
  ticker,
  sector_code,
  sector_label,
  source,
  source_version,
  confidence,
  is_active
)
values
  ('MSFT', '45', 'Information Technology', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('NVDA', '45', 'Information Technology', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('AMZN', '25', 'Consumer Discretionary', 'seed-manual', 'seed-manual-v1', 0.93, true),
  ('META', '50', 'Communication Services', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('GOOG', '50', 'Communication Services', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('BRK.B', '40', 'Financials', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('JPM', '40', 'Financials', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('XOM', '10', 'Energy', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('LLY', '35', 'Health Care', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('V', '40', 'Financials', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('AVGO', '45', 'Information Technology', 'seed-manual', 'seed-manual-v1', 0.93, true),
  ('TSLA', '25', 'Consumer Discretionary', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('UNH', '35', 'Health Care', 'seed-manual', 'seed-manual-v1', 0.95, true),
  ('MA', '40', 'Financials', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('COST', '30', 'Consumer Staples', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('HD', '25', 'Consumer Discretionary', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('PG', '30', 'Consumer Staples', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('NFLX', '50', 'Communication Services', 'seed-manual', 'seed-manual-v1', 0.9, true),
  ('PYPL', '40', 'Financials', 'seed-manual', 'seed-manual-v1', 0.88, true),
  ('BABA', '25', 'Consumer Discretionary', 'seed-manual', 'seed-manual-v1', 0.88, true)
on conflict do nothing;

insert into public.run_ledger (
  id,
  run_kind,
  run_status,
  trigger_mode,
  request_signature,
  target_institution_id,
  target_accession_number,
  parser_version,
  transform_version,
  input_payload,
  row_counts,
  warnings,
  error_payload,
  started_at,
  ended_at
)
values
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'filing_fetch',
    'succeeded',
    'manual',
    'seed-run-filing-fetch-v1',
    '11111111-1111-1111-1111-111111111111',
    '0001067983-24-000001',
    '13f-xml-1.9',
    'v1',
    '{"scope":"priority","replay":false}'::jsonb,
    '{"filings_upserted":1,"positions_upserted":2,"prices_upserted":2,"metrics_upserted":1}'::jsonb,
    '[]'::jsonb,
    null,
    '2024-02-14 18:00:00+00',
    '2024-02-14 18:02:10+00'
  )
on conflict do nothing;

commit;
