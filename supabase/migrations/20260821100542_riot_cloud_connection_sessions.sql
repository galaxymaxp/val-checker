begin;

-- Acquisition is replaceable independently from the renewable Riot session
-- and storefront pipeline. Existing rows predate this field and are therefore
-- marked legacy instead of being guessed as one of the current providers.
alter table public.riot_connections
add column acquisition_provider text not null default 'legacy',
add constraint riot_connections_acquisition_provider_check check (
  acquisition_provider in (
    'cloud-browser',
    'manual-cookie',
    'riot-login',
    'legacy'
  )
);

comment on column public.riot_connections.acquisition_provider is
  'How the encrypted renewable Riot cookie jar was acquired. Storefront transport is intentionally independent.';

-- Control-plane record only. Riot credentials, MFA codes, cookies, access
-- tokens, entitlement tokens, screenshots, and stream bearer tokens are never
-- stored here. provider_session_id is server-only and names an ephemeral
-- browser on the separately hosted browser service.
create table public.riot_cloud_connection_sessions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users (id) on delete cascade,
  target_connection_id       uuid references public.riot_connections (id) on delete set null,
  provider_session_id        text unique,
  state                      text not null default 'created' check (
    state in (
      'created',
      'starting_browser',
      'waiting_for_user',
      'authenticating',
      'capturing_session',
      'validating_session',
      'connected',
      'failed',
      'expired',
      'cancelled'
    )
  ),
  region                     text not null,
  label                      text,
  created_at                 timestamptz not null default now(),
  expires_at                 timestamptz not null,
  consumed_at                timestamptz,
  destroyed_at               timestamptz,
  last_heartbeat_at           timestamptz,
  failure_code               text check (
    failure_code is null or failure_code in (
      'browser_unavailable',
      'capture_failed',
      'expired',
      'internal',
      'riot_rejected',
      'storefront_failed',
      'validation_failed'
    )
  ),
  mfa_requested              boolean not null default false,
  captcha_observed           boolean not null default false,
  validation_succeeded       boolean not null default false,
  storefront_succeeded       boolean not null default false,
  reauth_test_succeeded      boolean not null default false,
  constraint riot_cloud_connection_sessions_expiry_check check (
    expires_at > created_at
  ),
  constraint riot_cloud_connection_sessions_consumed_check check (
    consumed_at is null or state = 'connected'
  )
);

comment on table public.riot_cloud_connection_sessions is
  'Short-lived owner-bound control records for isolated cloud Riot login browsers. Contains no Riot secret material.';

create index riot_cloud_connection_sessions_user_id_created_at_idx
  on public.riot_cloud_connection_sessions (user_id, created_at desc);

create index riot_cloud_connection_sessions_expires_at_idx
  on public.riot_cloud_connection_sessions (expires_at)
  where consumed_at is null;

alter table public.riot_cloud_connection_sessions enable row level security;

revoke all on table public.riot_cloud_connection_sessions
from anon, authenticated;

-- Direct browser access is read-only and column-limited so the external
-- provider identifier never crosses the Data API boundary. Mutations go
-- through authenticated application routes using the server-only key.
grant select (
  id,
  user_id,
  target_connection_id,
  state,
  region,
  label,
  created_at,
  expires_at,
  consumed_at,
  destroyed_at,
  last_heartbeat_at,
  failure_code,
  mfa_requested,
  captcha_observed,
  validation_succeeded,
  storefront_succeeded,
  reauth_test_succeeded
) on public.riot_cloud_connection_sessions to authenticated;

grant all on table public.riot_cloud_connection_sessions to service_role;

create policy "own cloud connection sessions read"
on public.riot_cloud_connection_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

commit;
