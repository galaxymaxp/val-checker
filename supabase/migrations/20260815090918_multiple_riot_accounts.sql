begin;

-- One login may now watch several Riot accounts. The daily cadence moves with
-- it: the cap becomes one storefront request per connection per UTC rotation,
-- so N connected accounts make N requests per day rather than one.
alter table public.riot_connections
drop constraint riot_connections_user_id_key;

alter table public.riot_connections
add column label text;

comment on column public.riot_connections.label is
  'Operator-supplied name distinguishing one connected Riot account from another.';

-- Partial on purpose: two accounts may both be unlabelled, but a name that is
-- given must stay unique within the login so the two can be told apart.
create unique index riot_connections_user_id_label_key
  on public.riot_connections (user_id, label)
  where label is not null;

create index riot_connections_user_id_idx
  on public.riot_connections (user_id);

-- The daily claim was keyed per user, which would cap every login at a single
-- account per day. Re-key it per connection.
alter table public.riot_daily_runs
drop constraint riot_daily_runs_user_id_store_date_key;

alter table public.riot_daily_runs
add constraint riot_daily_runs_connection_id_store_date_key
unique (connection_id, store_date);

create index riot_daily_runs_user_id_store_date_idx
  on public.riot_daily_runs (user_id, store_date);

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
    -- A login may spend at most one request per connected account per day.
    -- Counting runs already taken against the accounts currently held keeps
    -- disconnect-and-reconnect from minting a fresh allowance, which the
    -- per-connection key alone would permit.
    and (
      select count(*)
      from public.riot_daily_runs as taken
      where taken.user_id = p_user_id
        and taken.store_date = utc_store_date
    ) < (
      select count(*)
      from public.riot_connections as held
      where held.user_id = p_user_id
    )
  on conflict on constraint riot_daily_runs_connection_id_store_date_key
  do nothing
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
  'Claims at most one Riot storefront run per connection per UTC store date, and never more runs in a day than the login currently has connected accounts.';

commit;
