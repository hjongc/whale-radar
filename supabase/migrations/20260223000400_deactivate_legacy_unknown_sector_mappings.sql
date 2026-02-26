begin;

update public.security_sector_map
set
  is_active = false,
  updated_at = timezone('utc', now())
where is_active = true
  and sector_label = 'Unknown'
  and source in ('bootstrap-auto-v1', 'db-auto-gics11-v1');

commit;
