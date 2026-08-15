begin;

alter table public.shop_checks
add column rotation_date date;

update public.shop_checks
set rotation_date = (checked_at at time zone 'UTC')::date
where rotation_date is null;

alter table public.shop_checks
alter column rotation_date set not null;

alter table public.shop_checks
add constraint shop_checks_connection_rotation_date_key
unique (connection_id, rotation_date);

create or replace function public.reserve_storefront_notification(
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

  insert into public.notifications (user_id, skin_uuid, shop_check_id)
  values (p_user_id, p_skin_uuid, reserved_shop_check_id)
  on conflict on constraint notifications_user_id_skin_uuid_shop_check_id_key
  do nothing
  returning id, emailed_at
  into reserved_notification_id, reserved_notification_emailed_at;

  if reserved_notification_id is null then
    select notification.id, notification.emailed_at
    into reserved_notification_id, reserved_notification_emailed_at
    from public.notifications as notification
    where notification.user_id = p_user_id
      and notification.skin_uuid = p_skin_uuid
      and notification.shop_check_id = reserved_shop_check_id;
  end if;

  return query
  select
    reserved_notification_id,
    reserved_notification_emailed_at,
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
) is 'Atomically reserves one per-user, per-skin notification for a UTC storefront rotation.';

commit;
