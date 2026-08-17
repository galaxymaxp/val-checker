begin;

-- A Riot identity is global. Keeping one live connection row per PUUID prevents
-- changing application users or connection IDs from minting another manual
-- refresh for the same Riot account.
create unique index riot_connections_puuid_key
  on public.riot_connections (puuid)
  where puuid is not null;

comment on index public.riot_connections_puuid_key is
  'A non-null Riot PUUID may belong to only one live connection.';

-- Cron, manual and operator runs have independent daily allowances, but they
-- must never rotate the same encrypted session concurrently. This logical
-- lease is acquired in a short transaction before any Riot call. A worker that
-- dies before the storefront fence can be replaced after five minutes; once a
-- storefront might be in flight, the lease clears only after that exact
-- attempt is durably recorded, the next UTC store day, or an exact reconnect
-- (which rotates connection_epoch).
alter table public.riot_connections
add column rotation_lease_token uuid,
add column rotation_lease_claimed_at timestamptz,
add column rotation_lease_store_date date,
add column rotation_lease_storefront_attempted_at timestamptz,
add constraint riot_connections_rotation_lease_shape_check check (
  (
    rotation_lease_token is null
    and rotation_lease_claimed_at is null
    and rotation_lease_store_date is null
    and rotation_lease_storefront_attempted_at is null
  )
  or (
    rotation_lease_token is not null
    and rotation_lease_claimed_at is not null
    and rotation_lease_store_date is not null
    and (
      rotation_lease_storefront_attempted_at is null
      or rotation_lease_storefront_attempted_at >= rotation_lease_claimed_at
    )
  )
);

comment on column public.riot_connections.rotation_lease_token is
  'Service-only fencing token for the one live Riot session/storefront pipeline currently owning this connection.';

comment on column public.riot_connections.rotation_lease_storefront_attempted_at is
  'When set, an ambiguous crashed storefront request blocks another shared lease until the next UTC store day or reconnect.';

-- Automatic/operator attempts retain a minimal terminal marker so a handled
-- Riot/store persistence failure can atomically release the shared lease for
-- the independent manual allowance. An unhandled crash leaves both null.
alter table public.riot_daily_runs
add column storefront_failed_at timestamptz,
add column storefront_failure_reason text,
add constraint riot_daily_runs_storefront_failure_check check (
  (
    storefront_failed_at is null
    and storefront_failure_reason is null
  )
  or (
    storefront_attempted_at is not null
    and storefront_failed_at >= storefront_attempted_at
    and storefront_failure_reason = 'STOREFRONT_FAILED'
  )
);

comment on column public.riot_daily_runs.storefront_failed_at is
  'A terminal, handled post-attempt failure; null remains deliberately ambiguous after a worker crash.';

-- Preserve which existing account an MFA challenge is reconnecting. This is an
-- intentional snapshot rather than a foreign key so disconnecting while MFA is
-- pending cannot cascade or retarget the challenge.
alter table public.riot_pending_auth
add column connection_id uuid;

comment on column public.riot_pending_auth.connection_id is
  'Optional connection snapshot for replacing one exact Riot account after MFA.';

revoke all on table public.riot_pending_auth
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.riot_pending_auth
to service_role;

-- Persist a catalog-independent, display-safe representation before catalog
-- resolution. The application writes only canonical offer IDs, costs and
-- rewards here; raw Riot responses and session material never belong in it.
alter table public.shop_checks
add column offer_details jsonb not null default '[]'::jsonb;

alter table public.shop_checks
add constraint shop_checks_offer_details_array_check
check (jsonb_typeof(offer_details) = 'array');

comment on column public.shop_checks.offer_details is
  'Canonical storefront offer array: offer IDs, costs, rewards and optional resolved skin UUIDs only.';

create index notifications_shop_check_id_idx
  on public.notifications (shop_check_id);

-- Manual refreshes use a separate allowance from the automatic daily run. The
-- identity and ownership fields are snapshots on purpose: an allowance must
-- survive disconnect/reconnect and cannot be reset by replacing a connection.
create table public.riot_manual_refreshes (
  id uuid primary key default gen_random_uuid(),
  riot_puuid text not null,
  user_id uuid not null,
  connection_id uuid not null,
  connection_epoch uuid not null,
  store_date date not null,
  claim_token uuid not null default gen_random_uuid(),
  status text not null default 'claimed',
  claimed_at timestamptz not null default current_timestamp,
  storefront_attempted_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  constraint riot_manual_refreshes_riot_puuid_store_date_key
    unique (riot_puuid, store_date),
  constraint riot_manual_refreshes_status_check check (
    status in ('claimed', 'requesting', 'succeeded', 'retryable_failed')
  ),
  constraint riot_manual_refreshes_failure_reason_check check (
    failure_reason is null
    or failure_reason in (
      'LIFECYCLE_STALE',
      'REAUTH_FAILED',
      'SESSION_UNAVAILABLE',
      'STOREFRONT_FAILED',
      'UNEXPECTED'
    )
  ),
  constraint riot_manual_refreshes_attempt_order_check check (
    storefront_attempted_at is null
    or storefront_attempted_at >= claimed_at
  ),
  constraint riot_manual_refreshes_completion_order_check check (
    succeeded_at is null
    or (
      storefront_attempted_at is not null
      and succeeded_at >= storefront_attempted_at
    )
  ),
  constraint riot_manual_refreshes_failure_order_check check (
    failed_at is null
    or (
      failed_at >= claimed_at
      and (
        storefront_attempted_at is null
        or failed_at >= storefront_attempted_at
      )
    )
  ),
  constraint riot_manual_refreshes_state_check check (
    (
      status = 'claimed'
      and storefront_attempted_at is null
      and succeeded_at is null
      and failed_at is null
      and failure_reason is null
    )
    or (
      status = 'requesting'
      and storefront_attempted_at is not null
      and succeeded_at is null
      and (
        (failed_at is null and failure_reason is null)
        or (failed_at is not null and failure_reason is not null)
      )
    )
    or (
      status = 'succeeded'
      and storefront_attempted_at is not null
      and succeeded_at is not null
      and failed_at is null
      and failure_reason is null
    )
    or (
      status = 'retryable_failed'
      and storefront_attempted_at is null
      and succeeded_at is null
      and failed_at is not null
      and failure_reason is not null
    )
  )
);

comment on table public.riot_manual_refreshes is
  'Service-only, deletion-safe once-per-Riot-account manual refresh gate for each UTC store date.';

comment on column public.riot_manual_refreshes.status is
  'requesting with failed_at set is a closed post-attempt failure and remains unavailable until the next store date.';

create index riot_manual_refreshes_user_connection_store_date_idx
  on public.riot_manual_refreshes (user_id, connection_id, store_date desc);

alter table public.riot_manual_refreshes enable row level security;

revoke all on table public.riot_manual_refreshes
from public, anon, authenticated, service_role;
grant select, insert, update on table public.riot_manual_refreshes
to service_role;

create or replace function public.get_riot_store_day()
returns table (
  store_date date,
  next_reset_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    utc.store_date,
    (utc.store_date + 1)::timestamp at time zone 'UTC'
  from (
    select (current_timestamp at time zone 'UTC')::date as store_date
  ) as utc;
$$;

revoke all on function public.get_riot_store_day()
from public, anon, authenticated, service_role;
grant execute on function public.get_riot_store_day()
to service_role;

comment on function public.get_riot_store_day() is
  'Returns the PostgreSQL-derived UTC store date and the next 00:00 UTC reset.';

create or replace function public.claim_riot_session_rotation(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid
)
returns table (
  lease_status text,
  lease_token uuid,
  claimed_at timestamptz,
  store_date date
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  utc_store_date date := (current_timestamp at time zone 'UTC')::date;
  acquired_token uuid;
  acquired_at timestamptz;
begin
  update public.riot_connections as connection
  set
    rotation_lease_token = gen_random_uuid(),
    rotation_lease_claimed_at = statement_timestamp(),
    rotation_lease_store_date = utc_store_date,
    rotation_lease_storefront_attempted_at = null
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
    and (
      connection.rotation_lease_token is null
      -- An attempted lease is deliberately not time-reclaimable during the
      -- same store day: its storefront request may still be in flight.
      or connection.rotation_lease_store_date < utc_store_date
      or (
        connection.rotation_lease_storefront_attempted_at is null
        and connection.rotation_lease_claimed_at
          < current_timestamp - interval '5 minutes'
      )
    )
  returning
    connection.rotation_lease_token,
    connection.rotation_lease_claimed_at
  into acquired_token, acquired_at;

  if acquired_token is not null then
    return query
    select 'acquired'::text, acquired_token, acquired_at, utc_store_date;
    return;
  end if;

  if exists (
    select 1
    from public.riot_connections as connection
    where connection.user_id = p_user_id
      and connection.id = p_connection_id
      and connection.connection_epoch = p_connection_epoch
      and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
  ) then
    return query
    select
      'held'::text,
      null::uuid,
      null::timestamptz,
      utc_store_date;
  else
    return query
    select
      'account_unavailable'::text,
      null::uuid,
      null::timestamptz,
      utc_store_date;
  end if;
end;
$$;

revoke all on function public.claim_riot_session_rotation(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.claim_riot_session_rotation(uuid, uuid, uuid)
to service_role;

comment on function public.claim_riot_session_rotation(uuid, uuid, uuid) is
  'Claims the shared owner/connection/epoch session-rotation lease, rotating its token only after a pre-attempt five-minute timeout or at a later UTC store date.';

create or replace function public.renew_riot_session_rotation(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_lease_token uuid
)
returns table (renewed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.riot_connections as connection
  set rotation_lease_claimed_at = statement_timestamp()
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
    and connection.rotation_lease_token = p_lease_token
    and connection.rotation_lease_store_date
      = (current_timestamp at time zone 'UTC')::date
    and connection.rotation_lease_storefront_attempted_at is null
  returning connection.rotation_lease_claimed_at;
end;
$$;

revoke all on function public.renew_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.renew_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

comment on function public.renew_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) is 'Revalidates and renews the exact pre-attempt lease immediately before Riot reauthentication.';

create or replace function public.release_riot_session_rotation(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_lease_token uuid
)
returns table (released_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.riot_connections as connection
  set
    rotation_lease_token = null,
    rotation_lease_claimed_at = null,
    rotation_lease_store_date = null,
    rotation_lease_storefront_attempted_at = null
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_lease_token
    and connection.rotation_lease_storefront_attempted_at is null
  returning statement_timestamp();
end;
$$;

revoke all on function public.release_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.release_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

comment on function public.release_riot_session_rotation(
  uuid,
  uuid,
  uuid,
  uuid
) is 'Idempotently releases only an exact owner/connection/epoch/token lease that has not crossed the storefront-attempt fence.';

create or replace function public.claim_riot_manual_refresh(
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_rotation_lease_token uuid
)
returns table (
  claim_status text,
  run_id uuid,
  claim_token uuid,
  store_date date,
  claimed_at timestamptz,
  next_reset_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  utc_store_date date := (current_timestamp at time zone 'UTC')::date;
  utc_next_reset_at timestamptz :=
    (utc_store_date + 1)::timestamp at time zone 'UTC';
  connection_puuid text;
  claimed_run_id uuid;
  claimed_token uuid;
  claimed_store_date date;
  claimed_timestamp timestamptz;
begin
  select connection.puuid
  into connection_puuid
  from public.riot_connections as connection
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status = 'CONNECTED'::public.auth_status
    and connection.puuid is not null
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date = utc_store_date
    and connection.rotation_lease_storefront_attempted_at is null;

  if connection_puuid is null then
    return query
    select
      'account_unavailable'::text,
      null::uuid,
      null::uuid,
      utc_store_date,
      null::timestamptz,
      utc_next_reset_at;
    return;
  end if;

  -- A transaction-scoped identity lock closes the check/reclaim race while the
  -- unique constraint remains the final invariant. Hash collisions only cause
  -- harmless extra serialization.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'riot-manual-refresh:' || connection_puuid,
      0
    )
  );

  -- Revalidate and lock after the identity advisory lock. Reconnect, ownership
  -- or lease rotation between the discovery read and this point cannot spend
  -- an allowance for the stale snapshot.
  select connection.puuid
  into connection_puuid
  from public.riot_connections as connection
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status = 'CONNECTED'::public.auth_status
    and connection.puuid = connection_puuid
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date = utc_store_date
    and connection.rotation_lease_storefront_attempted_at is null
  for update;

  if connection_puuid is null then
    return query
    select
      'account_unavailable'::text,
      null::uuid,
      null::uuid,
      utc_store_date,
      null::timestamptz,
      utc_next_reset_at;
    return;
  end if;

  insert into public.riot_manual_refreshes (
    riot_puuid,
    user_id,
    connection_id,
    connection_epoch,
    store_date
  )
  values (
    connection_puuid,
    p_user_id,
    p_connection_id,
    p_connection_epoch,
    utc_store_date
  )
  on conflict on constraint riot_manual_refreshes_riot_puuid_store_date_key
  do update set
    user_id = excluded.user_id,
    connection_id = excluded.connection_id,
    connection_epoch = excluded.connection_epoch,
    claim_token = gen_random_uuid(),
    status = 'claimed',
    claimed_at = current_timestamp,
    storefront_attempted_at = null,
    succeeded_at = null,
    failed_at = null,
    failure_reason = null
  where riot_manual_refreshes.storefront_attempted_at is null
    and (
      riot_manual_refreshes.status = 'retryable_failed'
      -- Recover a worker that died before the Riot-attempt fence. Replacing
      -- its token guarantees that a merely slow stale worker cannot mark.
      or (
        riot_manual_refreshes.status = 'claimed'
        and riot_manual_refreshes.claimed_at
          < current_timestamp - interval '5 minutes'
      )
    )
  returning
    riot_manual_refreshes.id,
    riot_manual_refreshes.claim_token,
    riot_manual_refreshes.store_date,
    riot_manual_refreshes.claimed_at
  into
    claimed_run_id,
    claimed_token,
    claimed_store_date,
    claimed_timestamp;

  if claimed_run_id is not null then
    return query
    select
      'claimed'::text,
      claimed_run_id,
      claimed_token,
      claimed_store_date,
      claimed_timestamp,
      utc_next_reset_at;
  else
    return query
    select
      'held'::text,
      null::uuid,
      null::uuid,
      utc_store_date,
      null::timestamptz,
      utc_next_reset_at;
  end if;
end;
$$;

revoke all on function public.claim_riot_manual_refresh(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.claim_riot_manual_refresh(uuid, uuid, uuid, uuid)
to service_role;

comment on function public.claim_riot_manual_refresh(uuid, uuid, uuid, uuid) is
  'Locks the exact leased connection and returns a closed claimed, held or account_unavailable result without exposing the Riot identity; retryable or five-minute-stale pre-attempt claims receive a new fencing token.';

create or replace function public.mark_riot_manual_storefront_attempt(
  p_run_id uuid,
  p_claim_token uuid,
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_rotation_lease_token uuid
)
returns table (attempted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- JavaScript Date retains milliseconds. Truncating here lets raw canonical
  -- persistence prove it owns this exact attempted lease.
  marked_at timestamptz := date_trunc('milliseconds', statement_timestamp());
  current_connection_id uuid;
  updated_manual_id uuid;
begin
  -- Lock the connection first in every trigger-specific marker. The logical
  -- lease spans network work, but this database row lock lasts only for this
  -- short atomic state transition.
  select connection.id
  into current_connection_id
  from public.riot_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status = 'CONNECTED'::public.auth_status
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date
      = (current_timestamp at time zone 'UTC')::date
    and connection.rotation_lease_storefront_attempted_at is null
  for update;

  if current_connection_id is null then
    return;
  end if;

  update public.riot_manual_refreshes as manual
  set
    status = 'requesting',
    storefront_attempted_at = marked_at
  where manual.id = p_run_id
    and manual.claim_token = p_claim_token
    and manual.user_id = p_user_id
    and manual.connection_id = p_connection_id
    and manual.connection_epoch = p_connection_epoch
    and manual.store_date = (current_timestamp at time zone 'UTC')::date
    and manual.status = 'claimed'
    and manual.storefront_attempted_at is null
    and manual.riot_puuid = (
      select connection.puuid
      from public.riot_connections as connection
      where connection.id = current_connection_id
    )
  returning manual.id into updated_manual_id;

  if updated_manual_id is null then
    return;
  end if;

  update public.riot_connections as connection
  set rotation_lease_storefront_attempted_at = marked_at
  where connection.id = current_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_storefront_attempted_at is null;

  if not found then
    raise exception 'The session rotation lease changed while marking the storefront attempt.'
      using errcode = '40001';
  end if;

  return query select marked_at;
end;
$$;

revoke all on function public.mark_riot_manual_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mark_riot_manual_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

comment on function public.mark_riot_manual_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) is 'Atomically fences a manual run and its exact shared session-rotation lease immediately before the sole Riot storefront request.';

create or replace function public.fail_riot_manual_refresh(
  p_run_id uuid,
  p_claim_token uuid,
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_failure_reason text,
  p_retryable boolean
)
returns table (
  status text,
  failed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_retryable is null
    or p_failure_reason is null
    or p_failure_reason not in (
      'LIFECYCLE_STALE',
      'REAUTH_FAILED',
      'SESSION_UNAVAILABLE',
      'STOREFRONT_FAILED',
      'UNEXPECTED'
    )
  then
    raise exception 'Invalid manual refresh failure classification.'
      using errcode = '22023';
  end if;

  return query
  update public.riot_manual_refreshes as manual
  set
    status = case
      when p_retryable then 'retryable_failed'
      else manual.status
    end,
    failed_at = statement_timestamp(),
    failure_reason = p_failure_reason
  where manual.id = p_run_id
    and manual.claim_token = p_claim_token
    and manual.user_id = p_user_id
    and manual.connection_id = p_connection_id
    and manual.connection_epoch = p_connection_epoch
    and manual.store_date = (current_timestamp at time zone 'UTC')::date
    and (
      (
        p_retryable
        and manual.status = 'claimed'
        and manual.storefront_attempted_at is null
      )
      or (
        not p_retryable
        and manual.status = 'requesting'
        and manual.storefront_attempted_at is not null
        and manual.failed_at is null
      )
    )
  returning manual.status, manual.failed_at;
end;
$$;

revoke all on function public.fail_riot_manual_refresh(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function public.fail_riot_manual_refresh(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  boolean
) to service_role;

comment on function public.fail_riot_manual_refresh(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  boolean
) is 'Releases only a pre-attempt failure for retry; a post-attempt failure is recorded and remains exhausted for the UTC store date.';

create or replace function public.close_riot_storefront_attempt(
  p_run_id uuid,
  p_claim_token uuid,
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_rotation_lease_token uuid,
  p_trigger text
)
returns table (closed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  terminal_at timestamptz := statement_timestamp();
  leased_attempted_at timestamptz;
  leased_store_date date;
  updated_run_id uuid;
begin
  if p_trigger is null or p_trigger not in ('cron', 'manual', 'operator') then
    raise exception 'Invalid storefront refresh trigger.'
      using errcode = '22023';
  end if;

  select
    connection.rotation_lease_storefront_attempted_at,
    connection.rotation_lease_store_date
  into leased_attempted_at, leased_store_date
  from public.riot_connections as connection
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_storefront_attempted_at is not null
  for update;

  if leased_attempted_at is null then
    return;
  end if;

  if p_trigger = 'manual' then
    if p_claim_token is null then
      raise exception 'A manual claim token is required.'
        using errcode = '22023';
    end if;

    update public.riot_manual_refreshes as manual
    set
      failed_at = terminal_at,
      failure_reason = 'STOREFRONT_FAILED'
    where manual.id = p_run_id
      and manual.claim_token = p_claim_token
      and manual.user_id = p_user_id
      and manual.connection_id = p_connection_id
      and manual.connection_epoch = p_connection_epoch
      and manual.store_date = leased_store_date
      and manual.status = 'requesting'
      and manual.storefront_attempted_at = leased_attempted_at
      and manual.failed_at is null
    returning manual.id into updated_run_id;
  else
    if p_claim_token is not null then
      raise exception 'Automatic refreshes cannot use a manual claim token.'
        using errcode = '22023';
    end if;

    update public.riot_daily_runs as daily
    set
      storefront_failed_at = terminal_at,
      storefront_failure_reason = 'STOREFRONT_FAILED'
    where daily.id = p_run_id
      and daily.user_id = p_user_id
      and daily.connection_id = p_connection_id
      and daily.connection_epoch = p_connection_epoch
      and daily.store_date = leased_store_date
      and daily.storefront_attempted_at = leased_attempted_at
      and daily.storefront_failed_at is null
    returning daily.id into updated_run_id;
  end if;

  if updated_run_id is null then
    return;
  end if;

  update public.riot_connections as connection
  set
    rotation_lease_token = null,
    rotation_lease_claimed_at = null,
    rotation_lease_store_date = null,
    rotation_lease_storefront_attempted_at = null
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_storefront_attempted_at = leased_attempted_at;

  if not found then
    raise exception 'The session rotation lease changed while closing the storefront attempt.'
      using errcode = '40001';
  end if;

  return query select terminal_at;
end;
$$;

revoke all on function public.close_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.close_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) to service_role;

comment on function public.close_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) is 'Atomically records a handled post-attempt failure and clears only its exact shared lease; an ambiguous crash remains fenced.';

create or replace function public.record_storefront_refresh(
  p_connection_id uuid,
  p_user_id uuid,
  p_connection_epoch uuid,
  p_rotation_date date,
  p_checked_at timestamptz,
  p_shop_hash text,
  p_offer_skin_uuids uuid[],
  p_offer_details jsonb,
  p_expires_at timestamptz,
  p_manual_run_id uuid default null,
  p_manual_claim_token uuid default null,
  p_rotation_lease_token uuid default null
)
returns table (
  shop_check_id uuid,
  manual_succeeded_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_riot_puuid text;
  recorded_shop_check_id uuid;
  completed_manual_at timestamptz;
  owns_active_attempt boolean := false;
begin
  if p_rotation_date is null
    or p_checked_at is null
    or (p_checked_at at time zone 'UTC')::date <> p_rotation_date
    or p_shop_hash is null
    or p_offer_details is null
    or pg_catalog.jsonb_typeof(p_offer_details) <> 'array'
  then
    raise exception 'Invalid canonical storefront refresh payload.'
      using errcode = '22023';
  end if;

  if (p_manual_run_id is null) <> (p_manual_claim_token is null) then
    raise exception 'Manual run ID and claim token must be provided together.'
      using errcode = '22023';
  end if;

  if p_rotation_lease_token is null and p_manual_run_id is not null then
    raise exception 'Manual completion requires the active rotation lease.'
      using errcode = '22023';
  end if;

  -- Reconnect and another trigger cannot change epoch/lease state between
  -- validation, shop persistence, manual completion and lease release.
  select
    connection.puuid,
    (
      p_rotation_lease_token is not null
      and connection.rotation_lease_token = p_rotation_lease_token
      and connection.rotation_lease_store_date = p_rotation_date
      and connection.rotation_lease_storefront_attempted_at = p_checked_at
    )
  into current_riot_puuid, owns_active_attempt
  from public.riot_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
  for update;

  if not found then
    raise exception 'The Riot connection is not available for this user and epoch.'
      using errcode = 'P0001';
  end if;

  if p_rotation_lease_token is null then
    -- Catalog enrichment may only decorate the raw row for this exact attempt.
    -- It never rewinds checked_at or overwrites a newer trigger's storefront.
    update public.shop_checks as shop
    set
      offer_skin_uuids = coalesce(p_offer_skin_uuids, '{}'::uuid[]),
      offer_details = p_offer_details,
      expires_at = p_expires_at
    where shop.connection_id = p_connection_id
      and shop.rotation_date = p_rotation_date
      and shop.checked_at = p_checked_at
      and shop.shop_hash = p_shop_hash
    returning shop.id into recorded_shop_check_id;

    if recorded_shop_check_id is null then
      raise exception 'The storefront enrichment target is stale.'
        using errcode = 'P0001';
    end if;

    return query select recorded_shop_check_id, null::timestamptz;
    return;
  end if;

  if not owns_active_attempt then
    -- A committed-but-response-lost raw write is replayable only while the
    -- exact canonical snapshot is still current. A newer trigger cannot be
    -- overwritten by this stale token.
    select shop.id
    into recorded_shop_check_id
    from public.shop_checks as shop
    where shop.connection_id = p_connection_id
      and shop.rotation_date = p_rotation_date
      and shop.checked_at = p_checked_at
      and shop.shop_hash = p_shop_hash
      and shop.offer_skin_uuids = coalesce(p_offer_skin_uuids, '{}'::uuid[])
      and shop.offer_details = p_offer_details
      and shop.expires_at is not distinct from p_expires_at;

    if recorded_shop_check_id is null then
      raise exception 'The session rotation lease is unavailable or stale.'
        using errcode = 'P0001';
    end if;

    if p_manual_run_id is not null then
      select manual.succeeded_at
      into completed_manual_at
      from public.riot_manual_refreshes as manual
      where manual.id = p_manual_run_id
        and manual.claim_token = p_manual_claim_token
        and manual.user_id = p_user_id
        and manual.connection_id = p_connection_id
        and manual.connection_epoch = p_connection_epoch
        and manual.riot_puuid = current_riot_puuid
        and manual.store_date = p_rotation_date
        and manual.status = 'succeeded'
        and manual.succeeded_at is not null;

      if completed_manual_at is null then
        raise exception 'The manual refresh claim is unavailable or stale.'
          using errcode = 'P0001';
      end if;
    end if;

    return query select recorded_shop_check_id, completed_manual_at;
    return;
  end if;

  insert into public.shop_checks (
    connection_id,
    checked_at,
    shop_hash,
    offer_skin_uuids,
    offer_details,
    expires_at,
    rotation_date
  )
  values (
    p_connection_id,
    p_checked_at,
    p_shop_hash,
    coalesce(p_offer_skin_uuids, '{}'::uuid[]),
    p_offer_details,
    p_expires_at,
    p_rotation_date
  )
  on conflict on constraint shop_checks_connection_rotation_date_key
  do update set
    checked_at = excluded.checked_at,
    shop_hash = excluded.shop_hash,
    offer_skin_uuids = excluded.offer_skin_uuids,
    offer_details = excluded.offer_details,
    expires_at = excluded.expires_at
  returning id into recorded_shop_check_id;

  if p_manual_run_id is not null then
    update public.riot_manual_refreshes as manual
    set
      status = 'succeeded',
      succeeded_at = statement_timestamp(),
      failed_at = null,
      failure_reason = null
    where manual.id = p_manual_run_id
      and manual.claim_token = p_manual_claim_token
      and manual.user_id = p_user_id
      and manual.connection_id = p_connection_id
      and manual.connection_epoch = p_connection_epoch
      and manual.riot_puuid = current_riot_puuid
      and manual.store_date = p_rotation_date
      and manual.status = 'requesting'
      and manual.storefront_attempted_at = p_checked_at
      and manual.failed_at is null
    returning manual.succeeded_at into completed_manual_at;

    if completed_manual_at is null then
      -- A caller may not know whether the preceding RPC committed. Replaying
      -- the same run/token and canonical payload is safe and returns the
      -- original completion without creating another allowance or Riot call.
      select manual.succeeded_at
      into completed_manual_at
      from public.riot_manual_refreshes as manual
      where manual.id = p_manual_run_id
        and manual.claim_token = p_manual_claim_token
        and manual.user_id = p_user_id
        and manual.connection_id = p_connection_id
        and manual.connection_epoch = p_connection_epoch
        and manual.riot_puuid = current_riot_puuid
        and manual.store_date = p_rotation_date
        and manual.status = 'succeeded'
        and manual.succeeded_at is not null;

      if completed_manual_at is null then
        raise exception 'The manual refresh claim is unavailable or stale.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.riot_connections as connection
  set
    rotation_lease_token = null,
    rotation_lease_claimed_at = null,
    rotation_lease_store_date = null,
    rotation_lease_storefront_attempted_at = null
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date = p_rotation_date
    and connection.rotation_lease_storefront_attempted_at = p_checked_at;

  if not found then
    raise exception 'The session rotation lease changed while recording the storefront.'
      using errcode = '40001';
  end if;

  return query
  select recorded_shop_check_id, completed_manual_at;
end;
$$;

revoke all on function public.record_storefront_refresh(
  uuid,
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  jsonb,
  timestamptz,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.record_storefront_refresh(
  uuid,
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  jsonb,
  timestamptz,
  uuid,
  uuid,
  uuid
) to service_role;

comment on function public.record_storefront_refresh(
  uuid,
  uuid,
  uuid,
  date,
  timestamptz,
  text,
  uuid[],
  jsonb,
  timestamptz,
  uuid,
  uuid,
  uuid
) is 'Atomically fences and persists each raw storefront, optionally succeeds a manual claim, releases that lease, and applies only exact-snapshot catalog enrichment.';

-- Preserve the existing per-user churn guard while serializing it. Without the
-- lock, claims for two different connection IDs can both observe taken < held.
drop function public.claim_riot_daily_run(uuid, uuid, uuid);

create function public.claim_riot_daily_run(
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
      -- A stale row already counted in taken must be allowed to reach the
      -- conflict handler; otherwise the capacity guard would prevent its own
      -- safe pre-attempt recovery.
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

revoke all on function public.claim_riot_daily_run(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.claim_riot_daily_run(uuid, uuid, uuid, uuid)
to service_role;

comment on function public.claim_riot_daily_run(uuid, uuid, uuid, uuid) is
  'Locks the exact shared lease, serially claims at most one automatic run per connection per UTC store date, safely recovers five-minute-stale pre-attempt claims, and never exceeds the login connection count.';

-- Replace the legacy marker so automatic and operator runs are fenced by the
-- same shared connection lease as manual work. Keeping the old overload would
-- leave an unfenced service-role path callable through PostgREST.
drop function public.mark_riot_storefront_attempt(uuid, uuid, uuid);

create function public.mark_riot_storefront_attempt(
  p_run_id uuid,
  p_user_id uuid,
  p_connection_id uuid,
  p_connection_epoch uuid,
  p_rotation_lease_token uuid
)
returns table (attempted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- JavaScript Date retains milliseconds. Truncating here lets raw canonical
  -- persistence prove it owns this exact attempted lease.
  marked_at timestamptz := date_trunc('milliseconds', statement_timestamp());
  current_connection_id uuid;
  updated_run_id uuid;
begin
  select connection.id
  into current_connection_id
  from public.riot_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.auth_status <> 'REAUTH_REQUIRED'::public.auth_status
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_store_date
      = (current_timestamp at time zone 'UTC')::date
    and connection.rotation_lease_storefront_attempted_at is null
  for update;

  if current_connection_id is null then
    return;
  end if;

  update public.riot_daily_runs as run
  set storefront_attempted_at = marked_at
  where run.id = p_run_id
    and run.user_id = p_user_id
    and run.connection_id = p_connection_id
    and run.connection_epoch = p_connection_epoch
    and run.store_date = (current_timestamp at time zone 'UTC')::date
    and run.storefront_attempted_at is null
  returning run.id into updated_run_id;

  if updated_run_id is null then
    return;
  end if;

  update public.riot_connections as connection
  set rotation_lease_storefront_attempted_at = marked_at
  where connection.id = current_connection_id
    and connection.user_id = p_user_id
    and connection.connection_epoch = p_connection_epoch
    and connection.rotation_lease_token = p_rotation_lease_token
    and connection.rotation_lease_storefront_attempted_at is null;

  if not found then
    raise exception 'The session rotation lease changed while marking the storefront attempt.'
      using errcode = '40001';
  end if;

  return query select marked_at;
end;
$$;

revoke all on function public.mark_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mark_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

comment on function public.mark_riot_storefront_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) is 'Atomically fences an automatic/operator run and its exact shared session-rotation lease immediately before the sole Riot storefront request.';

alter table public.riot_run_logs
add column trigger text not null default 'cron';

alter table public.riot_run_logs
add constraint riot_run_logs_trigger_check
check (trigger in ('cron', 'manual', 'operator'));

comment on column public.riot_run_logs.trigger is
  'Identifies the policy entry point without duplicating the refresh pipeline.';

alter table public.riot_run_logs
drop constraint riot_run_logs_reason_check;

alter table public.riot_run_logs
add constraint riot_run_logs_reason_check check (
  reason is null
  or reason in (
    'ACCOUNT_UNAVAILABLE',
    'ATTEMPT_FENCED',
    'CATALOG_FAILED',
    'DAILY_CLAIM_HELD',
    'DELIVERY_FAILED',
    'LIFECYCLE_STALE',
    'MANUAL_CLAIM_HELD',
    'NOT_ALLOWLISTED',
    'REAUTH_FAILED',
    'REAUTH_REQUIRED_SKIP',
    'SESSION_UNAVAILABLE',
    'SESSION_LEASE_HELD',
    'STOREFRONT_FAILED',
    'UNEXPECTED'
  )
);

commit;
