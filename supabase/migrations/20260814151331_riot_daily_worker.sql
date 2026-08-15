begin;

alter table public.riot_connections
add column connection_epoch uuid not null default gen_random_uuid();

comment on column public.riot_connections.connection_epoch is
  'Changes on every reconnect so an in-flight worker cannot mutate a replacement session.';

alter table public.notifications
add column delivery_attempted_at timestamptz;

comment on column public.notifications.delivery_attempted_at is
  'Durable at-most-once claim set before calling the email provider.';

drop function public.reserve_storefront_notification(
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  timestamptz,
  uuid
);

create function public.reserve_storefront_notification(
  p_connection_id uuid,
  p_user_id uuid,
  p_rotation_date date,
  p_checked_at timestamptz,
  p_shop_hash text,
  p_offer_skin_uuids uuid[],
  p_expires_at timestamptz,
  p_skin_uuid uuid
)
returns table (
  notification_id uuid,
  notification_emailed_at timestamptz,
  notification_delivery_claimed boolean,
  shop_check_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reserved_shop_check_id uuid;
  reserved_notification_id uuid;
  reserved_notification_emailed_at timestamptz;
  reserved_notification_delivery_claimed boolean := false;
begin
  if p_rotation_date is null
    or p_checked_at is null
    or (p_checked_at at time zone 'UTC')::date <> p_rotation_date
  then
    raise exception 'The storefront rotation date must match the UTC check date.'
      using errcode = '22023';
  end if;

  insert into public.shop_checks (
    connection_id,
    checked_at,
    shop_hash,
    offer_skin_uuids,
    expires_at,
    rotation_date
  )
  select
    connection.id,
    p_checked_at,
    p_shop_hash,
    coalesce(p_offer_skin_uuids, '{}'::uuid[]),
    p_expires_at,
    p_rotation_date
  from public.riot_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
  on conflict on constraint shop_checks_connection_rotation_date_key
  do nothing
  returning id into reserved_shop_check_id;

  if reserved_shop_check_id is null then
    select check_row.id
    into reserved_shop_check_id
    from public.shop_checks as check_row
    join public.riot_connections as connection
      on connection.id = check_row.connection_id
    where check_row.connection_id = p_connection_id
      and check_row.rotation_date = p_rotation_date
      and connection.user_id = p_user_id;
  end if;

  if reserved_shop_check_id is null then
    raise exception 'The Riot connection is not available for this user.'
      using errcode = 'P0001';
  end if;

  insert into public.notifications (
    user_id,
    skin_uuid,
    shop_check_id,
    delivery_attempted_at
  )
  values (
    p_user_id,
    p_skin_uuid,
    reserved_shop_check_id,
    statement_timestamp()
  )
  on conflict on constraint notifications_user_id_skin_uuid_shop_check_id_key
  do nothing
  returning id, emailed_at
  into reserved_notification_id, reserved_notification_emailed_at;

  if reserved_notification_id is not null then
    reserved_notification_delivery_claimed := true;
  else
    update public.notifications as notification
    set delivery_attempted_at = statement_timestamp()
    where notification.user_id = p_user_id
      and notification.skin_uuid = p_skin_uuid
      and notification.shop_check_id = reserved_shop_check_id
      and notification.emailed_at is null
      and notification.delivery_attempted_at is null
    returning notification.id, notification.emailed_at
    into reserved_notification_id, reserved_notification_emailed_at;

    if reserved_notification_id is not null then
      reserved_notification_delivery_claimed := true;
    else
      select notification.id, notification.emailed_at
      into reserved_notification_id, reserved_notification_emailed_at
      from public.notifications as notification
      where notification.user_id = p_user_id
        and notification.skin_uuid = p_skin_uuid
        and notification.shop_check_id = reserved_shop_check_id;
    end if;
  end if;

  return query
  select
    reserved_notification_id,
    reserved_notification_emailed_at,
    reserved_notification_delivery_claimed,
    reserved_shop_check_id;
end;
$$;

revoke all on function public.reserve_storefront_notification(
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  timestamptz,
  uuid
) from public, anon, authenticated;

grant execute on function public.reserve_storefront_notification(
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  timestamptz,
  uuid
) to service_role;

comment on function public.reserve_storefront_notification(
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  timestamptz,
  uuid
) is 'Atomically reserves both a daily notification row and its sole email-provider attempt.';

create table public.riot_daily_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  connection_epoch uuid not null,
  store_date date not null,
  claimed_at timestamptz not null default now(),
  storefront_attempted_at timestamptz,
  unique (user_id, store_date),
  constraint riot_daily_runs_attempt_order_check check (
    storefront_attempted_at is null or storefront_attempted_at >= claimed_at
  )
);

comment on table public.riot_daily_runs is
  'Service-only, deletion-safe daily Riot request gate. Connection identifiers are intentional snapshots, not foreign keys.';

alter table public.riot_daily_runs enable row level security;

revoke all on table public.riot_daily_runs
from public, anon, authenticated, service_role;
grant select, insert, update on table public.riot_daily_runs to service_role;

create or replace function public.claim_riot_daily_run(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid
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
begin
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
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
  on conflict on constraint riot_daily_runs_user_id_store_date_key do nothing
  returning
    riot_daily_runs.id,
    riot_daily_runs.store_date,
    riot_daily_runs.claimed_at;
end;
$$;

revoke all on function public.claim_riot_daily_run(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_riot_daily_run(uuid, uuid, uuid)
to service_role;

comment on function public.claim_riot_daily_run(uuid, uuid, uuid) is
  'Claims at most one Riot storefront run per user and PostgreSQL-derived UTC store date.';

create or replace function public.mark_riot_storefront_attempt(
  p_run_id uuid,
  p_user_id uuid,
  p_connection_epoch uuid
)
returns table (attempted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.riot_daily_runs as run
  set storefront_attempted_at = current_timestamp
  from public.riot_connections as connection
  where run.id = p_run_id
    and run.user_id = p_user_id
    and run.store_date = (current_timestamp at time zone 'UTC')::date
    and run.connection_id = connection.id
    and run.connection_epoch = p_connection_epoch
    and run.storefront_attempted_at is null
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
  returning run.storefront_attempted_at;
end;
$$;

revoke all on function public.mark_riot_storefront_attempt(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.mark_riot_storefront_attempt(uuid, uuid, uuid)
to service_role;

comment on function public.mark_riot_storefront_attempt(uuid, uuid, uuid) is
  'Atomically fences a daily run and records the single allowed storefront attempt immediately before the Riot request.';

commit;
