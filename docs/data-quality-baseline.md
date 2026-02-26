# Data Quality Baseline

Last updated: 2026-02-24

This document tracks baseline and post-rollout KPI measurements for the Top-50 integrity remediation workstream.

## How to run

Run the quality SQL in a Supabase/Postgres environment:

```sql
\i scripts/sql/quality-checks.sql
```

The script returns key/value rows with target bands:

- `top50_institution_count`
- `top50_ticker_missing_rate_pct`
- `top50_sector_coverage_pct`
- `top50_unknown_sector_ratio_pct`
- `non_positive_holding_rows`

## KPI log

| Environment | Date | top50_institution_count | top50_ticker_missing_rate_pct | top50_sector_coverage_pct | top50_unknown_sector_ratio_pct | non_positive_holding_rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| local | 2026-02-24 | 50 | 99.93 | 0.07 | 99.93 | 12 |
| staging | TBD | TBD | TBD | TBD | TBD | TBD |
| production | TBD | TBD | TBD | TBD | TBD | TBD |

## Target thresholds

- Top-50 institution count: `50`
- Ticker missing rate: `<= 20%`
- Sector coverage: `>= 80%`
- Unknown/unclassified ratio: `<= 15%`
- Non-positive value/share rows: `0`
