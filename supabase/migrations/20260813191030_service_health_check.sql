-- Build Spec §4 task 1.2: a server-only route must prove database access.
-- The function is intentionally service-role only and reveals only the integer 1.
begin;

create or replace function public.health_check()
returns integer
language sql
stable
set search_path = ''
as $$
  select 1;
$$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to service_role;

commit;
