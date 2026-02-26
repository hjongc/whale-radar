begin;

drop function if exists public.refresh_security_sector_map_from_positions();
drop function if exists public.gics11_sector_for_security(text, text);

commit;
