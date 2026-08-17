-- Disconnecting an account used to leak its automatic daily capacity for the
-- rest of the UTC store day. The capacity guard counted every riot_daily_runs
-- row for the user, including rows whose connection had since been deleted, so
-- reconnecting produced runs_today = 1 against connections = 1 and the claim
-- was refused. The stale-claim escape hatch could not help either: it matches
-- on connection_id, and a reconnect mints a new one.
--
-- Only count runs whose connection still exists. Everything else about the
-- claim is unchanged.
begin;

create or replace function public.claim_riot_daily_run(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_rotation_lease_token uuid
)
returns table (
  run_id uuid,
  store_date date,
  claimed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  utc_store_date date := (current_timestamp at time zone 'UTC')::date;
  current_connection_id uuid;
begin
  if p_user_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('riot-daily-run:' || p_user_id::text, 0)
  );

  select connection.id
  into current_connection_id
  from public.riot_connections as connection
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date = utc_store_date
    and connection.rotation_lease_storefront_attempted_at is null
  for update;

  if current_connection_id is null then
    return;
  end if;

  return query
  insert into public.riot_daily_runs (
    user_id,
    connection_id,
    connection_epoch,
    store_date
  )
  select
    connection.user_id,
    connection.id,
    connection.connection_epoch,
    utc_store_date
  from public.riot_connections as connection
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.id = current_connection_id
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date = utc_store_date
    and connection.rotation_lease_storefront_attempted_at is null
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
    and (
      exists (
        select 1
        from public.riot_daily_runs as stale
        where stale.connection_id = p_connection_id
          and stale.store_date = utc_store_date
          and stale.storefront_attempted_at is null
          and stale.claimed_at < current_timestamp - interval '5 minutes'
      )
      or (
        select count(*)
        from public.riot_daily_runs as taken
        join public.riot_connections as owned
          on owned.id = taken.connection_id
        where taken.user_id = p_user_id
          and taken.store_date = utc_store_date
      ) < (
        select count(*)
        from public.riot_connections as held
        where held.user_id = p_user_id
      )
    )
  on conflict on constraint riot_daily_runs_connection_id_store_date_key
  do update set
    user_id = excluded.user_id,
    connection_epoch = excluded.connection_epoch,
    claimed_at = current_timestamp,
    storefront_attempted_at = null,
    storefront_failed_at = null,
    storefront_failure_reason = null
  where riot_daily_runs.storefront_attempted_at is null
    and riot_daily_runs.claimed_at
      < current_timestamp - interval '5 minutes'
  returning
    riot_daily_runs.id,
    riot_daily_runs.store_date,
    riot_daily_runs.claimed_at;
end;
$$;

comment on function public.claim_riot_daily_run(uuid, uuid, uuid, uuid) is
  'Locks the exact shared lease, serially claims at most one automatic run per connection per UTC store date, safely recovers five-minute-stale pre-attempt claims, and counts only runs whose connection still exists.';

commit;
